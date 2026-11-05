import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CreateProjectDto, ProjectsService, UpdateProjectDto, UpdateSettingsDto } from './projects.service';

@Controller()
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  /** POST /api/projects — create project (Blank) */
  @Post('projects')
  async create(@Body() dto: CreateProjectDto) {
    return this.projectsService.createProject(dto);
  }

  /** GET /api/projects — portfolio list */
  @Get('projects')
  async list(
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('sort') sort?: string,
    @Query('order') order?: 'asc' | 'desc',
  ) {
    return this.projectsService.listProjects({ search, status, sort, order });
  }

  @Get('projects/:id')
  async get(@Param('id') id: string) {
    return this.projectsService.getProject(id);
  }

  @Patch('projects/:id')
  async update(@Param('id') id: string, @Body() dto: UpdateProjectDto) {
    return this.projectsService.updateProject(id, dto);
  }

  @Delete('projects/:id')
  async delete(@Param('id') id: string) {
    await this.projectsService.deleteProject(id);
    return { ok: true };
  }

  @Get('projects/:id/settings')
  async getSettings(@Param('id') id: string) {
    return this.projectsService.getProject(id).then(() => this.getSettingsInner(id));
  }

  private getSettingsInner(id: string) {
    return this.projectsService.updateSettings(id, {});
  }

  @Patch('projects/:id/settings')
  async updateSettings(@Param('id') id: string, @Body() dto: UpdateSettingsDto) {
    return this.projectsService.updateSettings(id, dto);
  }

  @Get('portfolios')
  async portfolios() {
    return this.projectsService.listPortfolios();
  }

  @Post('portfolios')
  async createPortfolio(@Body() dto: { name: string; description?: string }) {
    return this.projectsService.createPortfolio(dto.name, dto.description);
  }
}
