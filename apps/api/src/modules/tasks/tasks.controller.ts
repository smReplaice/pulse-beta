import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { BulkUpdateDto, CreateTaskDto, TasksService, UpdateTaskDto } from './tasks.service';

@Controller()
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  /** POST /api/projects/:id/tasks — add task */
  @Post('projects/:id/tasks')
  async create(@Param('id') id: string, @Body() dto: CreateTaskDto) {
    return this.tasksService.createTask(id, dto);
  }

  @Get('projects/:id/tasks')
  async list(@Param('id') id: string) {
    return this.tasksService.listTasks(id);
  }

  /** PATCH /api/tasks/:id — edit task (returns authoritative recalculated results) */
  @Patch('tasks/:id')
  async update(@Param('id') id: string, @Body() dto: UpdateTaskDto) {
    return this.tasksService.updateTask(id, dto);
  }

  /** POST /api/tasks/bulk — spreadsheet bulk updates */
  @Post('tasks/bulk')
  async bulk(@Body() dto: BulkUpdateDto & { projectId: string }) {
    return this.tasksService.bulkUpdate(dto.projectId, dto);
  }

  @Delete('tasks/:id')
  async delete(@Param('id') id: string, @Query('subtree') subtree?: string) {
    return this.tasksService.deleteTask(id, subtree !== 'false');
  }

  /** POST /api/tasks/:id/move — drag/reorder rows */
  @Post('tasks/:id/move')
  async move(@Param('id') id: string, @Body() dto: { beforeTaskId?: string | null }) {
    return this.tasksService.moveTask(id, dto.beforeTaskId ?? null);
  }

  /** POST /api/tasks/:id/indent */
  @Post('tasks/:id/indent')
  async indent(@Param('id') id: string) {
    return this.tasksService.indent(id);
  }

  /** POST /api/tasks/:id/outdent */
  @Post('tasks/:id/outdent')
  async outdent(@Param('id') id: string) {
    return this.tasksService.outdent(id);
  }
}

// Re-exported for the module's DTO surface
export { UpdateTaskDto };
