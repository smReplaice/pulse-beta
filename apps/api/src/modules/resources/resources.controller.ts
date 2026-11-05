import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import {
  CreateAssignmentDto,
  CreateResourceDto,
  ResourcesService,
  UpdateAssignmentDto,
  UpdateResourceDto,
} from './resources.service';

@Controller()
export class ResourcesController {
  constructor(private readonly resourcesService: ResourcesService) {}

  @Get('projects/:id/resources')
  async list(@Param('id') id: string) {
    return this.resourcesService.listResources(id);
  }

  @Post('projects/:id/resources')
  async create(@Param('id') id: string, @Body() dto: CreateResourceDto) {
    return this.resourcesService.createResource(id, dto);
  }

  @Patch('resources/:id')
  async update(@Param('id') id: string, @Body() dto: UpdateResourceDto) {
    return this.resourcesService.updateResource(id, dto);
  }

  @Delete('resources/:id')
  async remove(@Param('id') id: string) {
    await this.resourcesService.deleteResource(id);
    return { ok: true };
  }

  /** POST /api/tasks/:id/assignments — assign resources */
  @Post('tasks/:id/assignments')
  async assign(@Param('id') id: string, @Body() dto: CreateAssignmentDto) {
    return this.resourcesService.assign(id, dto);
  }

  @Patch('assignments/:id')
  async updateAssignment(@Param('id') id: string, @Body() dto: UpdateAssignmentDto) {
    return this.resourcesService.updateAssignment(id, dto);
  }

  @Delete('assignments/:id')
  async removeAssignment(@Param('id') id: string) {
    return this.resourcesService.removeAssignment(id);
  }

  @Get('projects/:id/assignments')
  async listAssignments(@Param('id') id: string) {
    return this.resourcesService.listAssignments(id);
  }
}
