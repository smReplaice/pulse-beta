import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { z } from 'zod';
import { ChatDeepSeek } from '@langchain/deepseek';
import { StateGraph, Annotation, END, START } from '@langchain/langgraph';
import { calculateSchedule } from '@pulse/engine';
import { AiActionLogEntity, TaskDependencyEntity, TaskEntity } from '../../entities';
import { ScheduleService } from '../schedule/schedule.service';
import { TasksService } from '../tasks/tasks.service';
import { DependenciesService } from '../dependencies/dependencies.service';

// ---------------------------------------------------------------- schemas

const CreateOpsSchema = z.object({
  kind: z.literal('create_tasks'),
  tasks: z
    .array(
      z.object({
        name: z.string(),
        outlineLevel: z.number().int().min(0).max(9).optional(),
        durationDays: z.number().min(0).max(3650).optional(),
        isMilestone: z.boolean().optional(),
        stage: z.string().optional(),
        trade: z.string().optional(),
        isProcurement: z.boolean().optional(),
        isApproval: z.boolean().optional(),
        isInspection: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(500),
  links: z
    .array(
      z.object({
        from: z.number().int().min(0), // index into tasks
        to: z.number().int().min(0),
        type: z.enum(['FS', 'SS', 'FF', 'SF']).optional(),
        lagDays: z.number().optional(),
      }),
    )
    .optional(),
});

const UpdateOpsSchema = z.object({
  kind: z.literal('update_tasks'),
  updates: z
    .array(
      z.object({
        taskName: z.string(),
        durationDays: z.number().optional(),
        percentComplete: z.number().optional(),
        priority: z.number().optional(),
        constraintType: z.enum(['ASAP', 'ALAP', 'SNET', 'SNLT', 'FNET', 'FNLT', 'MSO', 'MFO']).optional(),
        constraintDate: z.string().optional(),
        notes: z.string().optional(),
        delayReason: z.string().optional(),
      }),
    )
    .min(1),
});

const LinkOpsSchema = z.object({
  kind: z.literal('link_tasks'),
  links: z
    .array(
      z.object({
        fromName: z.string(),
        toName: z.string(),
        type: z.enum(['FS', 'SS', 'FF', 'SF']).optional(),
        lagDays: z.number().optional(),
      }),
    )
    .min(1),
});

const AnalysisSchema = z.object({
  kind: z.literal('analysis'),
  focus: z.enum(['critical_path', 'float', 'slippage', 'milestones', 'resources', 'progress', 'general']),
});

const ReplySchema = z.object({
  kind: z.literal('reply'),
  message: z.string(),
});

const ActionPlanSchema = z.union([
  CreateOpsSchema,
  UpdateOpsSchema,
  LinkOpsSchema,
  AnalysisSchema,
  ReplySchema,
]);

export type ActionPlan = z.infer<typeof ActionPlanSchema>;

// ---------------------------------------------------------------- graph state

const CopilotState = Annotation.Root({
  projectId: Annotation<string>,
  userMessage: Annotation<string>,
  agent: Annotation<string>,
  actionPlan: Annotation<ActionPlan | null>,
  scheduleSummary: Annotation<string>,
  finalReply: Annotation<string>,
  error: Annotation<string>,
});

interface CopilotResult {
  agent: string;
  actionPlan: ActionPlan | null;
  finalReply: string;
}

interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

/**
 * zod→structured-output generic inference explodes on deep union schemas
 * (TS2589); hide it behind a minimal typed runner.
 */
function structuredRunner(model: ChatDeepSeek, schema: z.ZodType): {
  invoke: (messages: ChatMessage[]) => Promise<never>;
} {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const runner = (model as unknown as { withStructuredOutput: (s: z.ZodType) => { invoke: (m: ChatMessage[]) => Promise<unknown> } }).withStructuredOutput(schema);
  return { invoke: (messages) => runner.invoke(messages) } as { invoke: (messages: ChatMessage[]) => Promise<never> };
}

const AGENT_PROMPTS: Record<string, { role: string; instructions: string }> = {
  programme_creation: {
    role: 'Programme Creation Agent',
    instructions:
      'Generate a construction work breakdown structure with tasks, milestones and dependencies from the user description. Output ONLY the structured plan: tasks (with outlineLevel for WBS depth, durationDays) and links (from/to indexes, type FS/SS/FF/SF, lagDays). Estimate realistic UK-construction durations. Include design approvals, procurement for long-lead items, inspections and a final handover milestone.',
  },
  schedule_editor: {
    role: 'Schedule Editor Agent',
    instructions:
      'Add, update, remove, reorder or link activities on the existing programme. Reference tasks by their exact names from the schedule summary. Output ONLY the structured operation plan.',
  },
  scheduling_analyst: {
    role: 'Scheduling Analyst Agent',
    instructions:
      'Examine critical path, float, constraints and slippage. Output the analysis operation with a focus field; the platform will compute the real numbers — never invent dates.',
  },
  resource_planner: {
    role: 'Resource Planner Agent',
    instructions:
      'Suggest resource assignments and capacity resolutions. For now, express recommendations as a reply; assignment execution requires explicit resource names.',
  },
  progress_analyst: {
    role: 'Progress Analyst Agent',
    instructions:
      'Evaluate baseline variance, actual progress and forecast completion using the supplied schedule summary. Output analysis or a reply.',
  },
  construction_advisor: {
    role: 'Construction Advisor Agent',
    instructions:
      'Advise on construction sequencing, procurement milestones, authority approvals and inspections. Express advice as a reply, or propose tasks/links to add missing activities.',
  },
};

// ---------------------------------------------------------------- service

@Injectable()
export class AiService {
  private readonly logger = new Logger('AiService');

  constructor(
    @InjectRepository(AiActionLogEntity) private readonly actionLogs: Repository<AiActionLogEntity>,
    @InjectRepository(TaskEntity) private readonly tasks: Repository<TaskEntity>,
    @InjectRepository(TaskDependencyEntity) private readonly deps: Repository<TaskDependencyEntity>,
    private readonly scheduleService: ScheduleService,
    private readonly tasksService: TasksService,
    private readonly dependenciesService: DependenciesService,
  ) {}

  private model(): ChatDeepSeek | null {
    const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
    if (!apiKey) return null;
    return new ChatDeepSeek({
      apiKey,
      model: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
      temperature: 0.2,
    });
  }

  /** POST /api/projects/:id/ai/chat */
  async chat(projectId: string, dto: { message: string; applyActionId?: string }) {
    await this.scheduleService.getProject(projectId);

    if (dto.applyActionId) {
      return this.applyLoggedAction(projectId, dto.applyActionId);
    }

    const model = this.model();
    if (!model) {
      return {
        reply:
          'The AI copilot is not configured yet. Add DEEPSEEK_API_KEY to apps/api/.env and restart the API. Everything else in Pulse works without it.',
        configured: false,
      };
    }

    const scheduleSummary = await this.describeSchedule(projectId);

    try {
      const graph = this.buildGraph(model);
      const final = await graph.invoke({
        projectId,
        userMessage: dto.message,
        scheduleSummary,
        agent: 'supervisor',
        finalReply: '',
        error: '',
      });

      const plan = final.actionPlan;
      if (plan && (plan.kind === 'create_tasks' || plan.kind === 'update_tasks' || plan.kind === 'link_tasks')) {
        const preview = await this.preview(projectId, plan);
        const log = await this.actionLogs.save(
          this.actionLogs.create({
            projectId,
            userPrompt: dto.message,
            agent: final.agent,
            action: plan as unknown as Record<string, unknown>,
            before: preview.before,
            after: preview.after,
            applied: false,
            undoToken: null,
          }),
        );
        return {
          reply: this.describePlan(plan),
          agent: final.agent,
          proposal: plan,
          preview,
          actionId: log.id,
          applied: false,
          configured: true,
        };
      }

      if (plan?.kind === 'analysis') {
        const analysis = await this.runAnalysis(projectId, plan.focus);
        return { reply: analysis, agent: final.agent, applied: false, configured: true };
      }

      return { reply: plan?.message ?? final.finalReply ?? 'Understood.', agent: final.agent, applied: false, configured: true };
    } catch (err) {
      this.logger.warn(`AI chat failed: ${String(err)}`);
      return {
        reply: `The copilot could not process that request (${String(err instanceof Error ? err.message : err)}). Try rephrasing, or make the edit manually — the copilot uses the same scheduling engine.`,
        configured: true,
        applied: false,
      };
    }
  }

  // ---------------------------------------------------------------- graph

  private buildGraph(model: ChatDeepSeek): { invoke: (input: unknown) => Promise<CopilotResult> } {
    const supervisor = async (state: { userMessage: string }) => {
      const route = await structuredRunner(
        model,
        z.object({ agent: z.enum([...(Object.keys(AGENT_PROMPTS) as [string]), 'reply']) }),
      ).invoke([
          {
            role: 'system',
            content:
              'Route the user request to the most suitable construction-scheduling agent: programme_creation (build a new programme/WBS), schedule_editor (edit/link existing tasks), scheduling_analyst (critical path/float/slippage), resource_planner (assignments/capacity), progress_analyst (baseline variance/progress), construction_advisor (sequencing/procurement advice). Use "reply" only for greetings or questions about the product itself.',
          },
          { role: 'user', content: state.userMessage },
        ]);
      return { agent: (route as unknown as { agent: string }).agent };
    };

    const agentNode = async (state: { agent: string; userMessage: string; scheduleSummary: string }) => {
      const config = AGENT_PROMPTS[state.agent] ?? AGENT_PROMPTS.construction_advisor;
      const structured = structuredRunner(model, ActionPlanSchema);
      const result = await structured.invoke([
        {
          role: 'system',
          content:
            `You are the ${config.role} of BiltFlow Pulse, a construction programme management tool. ${config.instructions} ` +
            'Never fabricate dates: the platform recomputes the schedule with its CPM engine. Reply with the JSON structure only.',
        },
        { role: 'user', content: `Schedule summary:\n${state.scheduleSummary}\n\nRequest: ${state.userMessage}` },
      ]);
      return { actionPlan: result };
    };

    // LangGraph's builder generics explode on deep union states; drive it untyped.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const graph: any = new StateGraph(CopilotState);
  graph.addNode('supervisor', supervisor);
  graph.addNode('agent', agentNode);
  graph.addEdge(START, 'supervisor');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  graph.addConditionalEdges('supervisor', (state: any) => (state.agent === 'reply' ? END : 'agent'));
  graph.addEdge('agent', END);

  return graph.compile() as { invoke: (input: unknown) => Promise<CopilotResult> };
  }

  // ---------------------------------------------------------------- preview / apply

  /**
   * Dry-run the plan through the PURE engine (no persistence) so the user sees
   * the exact dates the real APIs would produce — same calculations, no risk.
   */
  private async preview(projectId: string, plan: ActionPlan) {
    const input = await this.scheduleService.loadEngineInput(projectId);
    const before = calculateSchedule(input);

    const patched = this.applyToInput(structuredClone(input), plan);
    const after = calculateSchedule(patched);

    return {
      before: {
        projectFinish: before.projectFinish,
        criticalCount: before.stats.criticalCount,
      },
      after: {
        projectStart: after.projectStart,
        projectFinish: after.projectFinish,
        criticalCount: after.stats.criticalCount,
        warnings: after.warnings.slice(0, 20),
      },
      changedTasks: Object.keys(after.tasks)
        .filter((id) => {
          const b = before.tasks[id];
          const a = after.tasks[id];
          return b && a && (b.start !== a.start || b.finish !== a.finish);
        })
        .map((id) => ({
          taskId: id,
          name: patched.tasks.find((t) => t.id === id)?.name ?? id,
          start: after.tasks[id].start,
          finish: after.tasks[id].finish,
        })),
    };
  }

  private applyToInput(
    input: Awaited<ReturnType<ScheduleService['loadEngineInput']>>,
    plan: ActionPlan,
  ): Awaited<ReturnType<ScheduleService['loadEngineInput']>> {
    if (plan.kind === 'create_tasks') {
      const newIds: string[] = [];
      let order = input.tasks.reduce((m, t) => Math.max(m, t.rowOrder), 0) + 1000;
      for (const t of plan.tasks) {
        const id = `ai-${crypto.randomUUID()}`;
        newIds.push(id);
        input.tasks.push({
          id,
          name: t.name,
          rowOrder: order,
          outlineLevel: t.outlineLevel ?? 0,
          durationMinutes: t.isMilestone ? 0 : Math.round((t.durationDays ?? 5) * 480),
          durationMode: 'working',
          mode: 'auto',
          taskType: 'fixed_units',
          effortDriven: false,
          percentComplete: 0,
          constraint: null,
          calendarId: null,
          priority: 500,
          levelingDelayMinutes: 0,
          active: true,
          manualStart: null,
          manualFinish: null,
          fixedCost: 0,
          fixedCostAccrual: 'prorated',
          actualStart: null,
          actualFinish: null,
          actualWorkMinutes: 0,
          actualCost: null,
          deadline: null,
          stage: t.stage ?? null,
          trade: t.trade ?? null,
          isProcurement: t.isProcurement ?? false,
          isApproval: t.isApproval ?? false,
          isInspection: t.isInspection ?? false,
        });
        order += 1000;
      }
      for (const l of plan.links ?? []) {
        // from/to are indexes into the plan's task list, which maps 1:1 onto newIds
        const fromId = newIds[l.from];
        const toId = newIds[l.to];
        if (fromId && toId) {
          input.dependencies.push({
            id: `ai-${crypto.randomUUID()}`,
            predecessorId: fromId,
            successorId: toId,
            type: l.type ?? 'FS',
            lagMinutes: Math.round((l.lagDays ?? 0) * 480),
          });
        }
      }
      return input;
    }

    if (plan.kind === 'update_tasks') {
      for (const u of plan.updates) {
        const t = input.tasks.find((x) => x.name.toLowerCase() === u.taskName.toLowerCase());
        if (!t) continue;
        if (u.durationDays !== undefined) t.durationMinutes = Math.round(u.durationDays * 480);
        if (u.percentComplete !== undefined) t.percentComplete = u.percentComplete;
        if (u.priority !== undefined) t.priority = u.priority;
        if (u.constraintType) {
          t.constraint = {
            type: u.constraintType,
            date: u.constraintDate ?? t.constraint?.date ?? input.start,
          };
        }
        if (u.delayReason) t.delayReason = u.delayReason;
      }
      return input;
    }

    if (plan.kind === 'link_tasks') {
      for (const l of plan.links) {
        const from = input.tasks.find((x) => x.name.toLowerCase() === l.fromName.toLowerCase());
        const to = input.tasks.find((x) => x.name.toLowerCase() === l.toName.toLowerCase());
        if (from && to) {
          input.dependencies.push({
            id: `ai-${crypto.randomUUID()}`,
            predecessorId: from.id,
            successorId: to.id,
            type: l.type ?? 'FS',
            lagMinutes: Math.round((l.lagDays ?? 0) * 480),
          });
        }
      }
      return input;
    }

    return input;
  }

  /** Execute a logged proposal through the SAME services as manual edits. */
  async applyLoggedAction(projectId: string, actionId: string) {
    const log = await this.actionLogs.findOne({ where: { id: actionId, projectId } });
    if (!log) return { reply: 'That proposal is no longer available.', applied: false };
    if (log.applied) return { reply: 'This proposal was already applied.', applied: true };
    const plan = ActionPlanSchema.parse(log.action);

    const results: string[] = [];
    if (plan.kind === 'create_tasks') {
      let afterTaskId: string | null = null;
      const tasks = await this.tasks.find({ where: { projectId }, order: { rowOrder: 'ASC' } });
      afterTaskId = tasks[tasks.length - 1]?.id ?? null;
      const created: string[] = [];
      for (const t of plan.tasks) {
        const res = (await this.tasksService.createTask(projectId, {
          name: t.name,
          outlineLevel: t.outlineLevel ?? 0,
          durationMinutes: t.isMilestone ? 0 : Math.round((t.durationDays ?? 5) * 480),
          afterTaskId,
          autolink: false,
          stage: t.stage ?? null,
          trade: t.trade ?? null,
        })) as { task?: { id: string } };
        afterTaskId = res.task?.id ?? afterTaskId;
        if (res.task?.id) created.push(res.task.id);
      }
      for (const l of plan.links ?? []) {
        if (created[l.from] && created[l.to]) {
          await this.dependenciesService.create(created[l.to], {
            predecessorId: created[l.from],
            type: l.type ?? 'FS',
            lagMinutes: Math.round((l.lagDays ?? 0) * 480),
          });
        }
      }
      results.push(`Created ${created.length} tasks with ${plan.links?.length ?? 0} links.`);
    } else if (plan.kind === 'update_tasks') {
      const tasks = await this.tasks.find({ where: { projectId } });
      for (const u of plan.updates) {
        const t = tasks.find((x) => x.name.toLowerCase() === u.taskName.toLowerCase());
        if (!t) continue;
        await this.tasksService.updateTask(t.id, {
          durationMinutes: u.durationDays !== undefined ? Math.round(u.durationDays * 480) : undefined,
          percentComplete: u.percentComplete,
          priority: u.priority,
          constraintType: u.constraintType,
          constraintDate: u.constraintDate,
          delayReason: u.delayReason,
          notes: u.notes,
        });
      }
      results.push(`Updated ${plan.updates.length} tasks.`);
    } else if (plan.kind === 'link_tasks') {
      const tasks = await this.tasks.find({ where: { projectId } });
      for (const l of plan.links) {
        const from = tasks.find((x) => x.name.toLowerCase() === l.fromName.toLowerCase());
        const to = tasks.find((x) => x.name.toLowerCase() === l.toName.toLowerCase());
        if (from && to) {
          await this.dependenciesService.create(to.id, {
            predecessorId: from.id,
            type: l.type ?? 'FS',
            lagMinutes: Math.round((l.lagDays ?? 0) * 480),
          });
        }
      }
      results.push(`Added ${plan.links.length} links.`);
    }

    const recalc = await this.scheduleService.recalculate(projectId, 'ai');
    log.applied = true;
    log.undoToken = crypto.randomUUID();
    await this.actionLogs.save(log);

    return {
      reply: `Applied: ${results.join(' ')} The programme was recalculated (finish ${recalc.result.projectFinish.slice(0, 10)}).`,
      applied: true,
      actionId,
      undoToken: log.undoToken,
      scheduleVersion: recalc.scheduleVersion,
    };
  }

  /** POST /api/projects/:id/ai/undo — revert an applied action by id */
  async undo(projectId: string, actionId: string) {
    const log = await this.actionLogs.findOne({ where: { id: actionId, projectId } });
    if (!log || !log.applied) return { reply: 'Nothing to undo.', undone: false };
    const plan = ActionPlanSchema.parse(log.action);
    if (plan.kind === 'create_tasks') {
      const tasks = await this.tasks.find({ where: { projectId }, order: { rowOrder: 'ASC' } });
      for (const t of tasks) {
        if (plan.tasks.some((p) => p.name.toLowerCase() === t.name.toLowerCase())) {
          await this.tasksService.deleteTask(t.id, true);
        }
      }
    } else if (plan.kind === 'update_tasks' && log.before) {
      const tasks = await this.tasks.find({ where: { projectId } });
      for (const [taskId, snapshot] of Object.entries(log.before)) {
        const t = tasks.find((x) => x.id === taskId);
        if (t && snapshot && typeof snapshot === 'object') {
          const snap = snapshot as Record<string, unknown>;
          if (typeof snap.durationMinutes === 'number') {
            await this.tasksService.updateTask(t.id, { durationMinutes: snap.durationMinutes });
          }
        }
      }
    } else if (plan.kind === 'link_tasks') {
      const deps = await this.deps.find({ where: { projectId } });
      const nameOf = new Map((await this.tasks.find({ where: { projectId } })).map((t) => [t.id, t.name.toLowerCase()]));
      for (const l of plan.links) {
        const dep = deps.find(
          (d) => nameOf.get(d.predecessorId) === l.fromName.toLowerCase() && nameOf.get(d.successorId) === l.toName.toLowerCase(),
        );
        if (dep) await this.dependenciesService.delete(dep.id);
      }
    }
    log.undone = true;
    await this.actionLogs.save(log);
    const recalc = await this.scheduleService.recalculate(projectId, 'ai_undo');
    return { reply: 'Reverted. The programme was recalculated.', undone: true, scheduleVersion: recalc.scheduleVersion };
  }

  // ---------------------------------------------------------------- helpers

  private async describeSchedule(projectId: string): Promise<string> {
    const input = await this.scheduleService.loadEngineInput(projectId);
    const result = calculateSchedule(input);
    const lines = input.tasks
      .map((t, i) => {
        const r = result.tasks[t.id];
        return `${i + 1}. [${t.outlineLevel}] ${t.name} — ${r ? `${r.durationMinutes / 480}d, ${r.start.slice(0, 10)}→${r.finish.slice(0, 10)}, float ${r.totalFloatMinutes != null ? r.totalFloatMinutes / 480 : '?'}d${r.isCritical ? ', CRITICAL' : ''}` : 'summary'}`;
      })
      .slice(0, 150);
    return [
      `Project finish: ${result.projectFinish.slice(0, 10)}`,
      `Critical tasks: ${result.stats.criticalCount}`,
      `Tasks:`,
      ...lines,
    ].join('\n');
  }

  private async runAnalysis(projectId: string, focus: string): Promise<string> {
    const input = await this.scheduleService.loadEngineInput(projectId);
    const result = calculateSchedule(input);
    const nameOf = new Map(input.tasks.map((t) => [t.id, t.name]));
    const d = (m: number | null) => (m == null ? '—' : `${Math.round((m / 480) * 10) / 10} d`);
    const head = `Programme finish: ${result.projectFinish.slice(0, 10)} · ${result.stats.taskCount} tasks · ${result.stats.criticalCount} critical`;
    if (focus === 'critical_path') {
      const path = result.criticalPathIds.map((id) => nameOf.get(id) ?? id).join(' → ');
      return `${head}\n\nDriving critical path:\n${path}\n\nNear-critical and floated activities are visible in the Gantt with critical highlighting on.`;
    }
    if (focus === 'float') {
      const rows = Object.values(result.tasks)
        .filter((t) => !t.isSummary && t.totalFloatMinutes !== null)
        .sort((a, b) => (a.totalFloatMinutes ?? 0) - (b.totalFloatMinutes ?? 0))
        .slice(0, 15)
        .map((t) => `• ${nameOf.get(t.id)} — float ${d(t.totalFloatMinutes)}`);
      return `${head}\n\nTightest activities:\n${rows.join('\n')}`;
    }
    if (focus === 'milestones') {
      const ms = Object.values(result.tasks).filter((t) => t.isMilestone);
      return `${head}\n\nMilestones:\n${ms.map((m) => `• ${nameOf.get(m.id)} — ${m.start.slice(0, 10)}${m.isCritical ? ' (critical)' : ''}`).join('\n')}`;
    }
    if (focus === 'resources') {
      const over = result.resourceUsage.filter((r) => r.overallocatedDays.length > 0);
      return `${head}\n\n${over.length === 0 ? 'No over-allocations detected.' : `Over-allocated resources:\n${over.map((r) => `• ${input.resources.find((x) => x.id === r.resourceId)?.name ?? r.resourceId} on ${r.overallocatedDays.slice(0, 5).join(', ')} (peak ${Math.round(r.peakUnits * 100)}%)`).join('\n')}\n\nUse Resource Usage → Level Resources for a preview.`}`;
    }
    const warnings = result.warnings.slice(0, 10).map((w) => `• ${w.message}`);
    return `${head}\n\n${warnings.length ? `Warnings:\n${warnings.join('\n')}` : 'No scheduling warnings.'}`;
  }

  private describePlan(plan: ActionPlan): string {
    if (plan.kind === 'create_tasks') {
      return `Proposed programme: ${plan.tasks.length} activities and ${plan.links?.length ?? 0} links. Review the preview below — dates come from the CPM engine — then Apply.`;
    }
    if (plan.kind === 'update_tasks') {
      return `Proposed ${plan.updates.length} task update(s). Review the preview below, then Apply.`;
    }
    if (plan.kind === 'link_tasks') {
      return `Proposed ${plan.links.length} new link(s). Review the preview below, then Apply.`;
    }
    return 'Here is my analysis.';
  }
}
