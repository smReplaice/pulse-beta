import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { CreateDependencyDto, DependenciesService, UpdateDependencyDto } from './dependencies.service';

@Controller()
export class DependenciesController {
  constructor(private readonly dependenciesService: DependenciesService) {}

  @Get('projects/:id/dependencies')
  async list(@Param('id') id: string) {
    return this.dependenciesService.list(id);
  }

  /** POST /api/tasks/:id/dependencies — add dependency */
  @Post('tasks/:id/dependencies')
  async create(@Param('id') id: string, @Body() dto: CreateDependencyDto) {
    return this.dependenciesService.create(id, dto);
  }

  /** PATCH /api/dependencies/:id — change FS/SS/FF/SF or lag */
  @Patch('dependencies/:id')
  async update(@Param('id') id: string, @Body() dto: UpdateDependencyDto) {
    return this.dependenciesService.update(id, dto);
  }

  @Delete('dependencies/:id')
  async delete(@Param('id') id: string) {
    return this.dependenciesService.delete(id);
  }
}
