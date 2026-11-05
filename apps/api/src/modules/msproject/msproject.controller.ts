import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MsProjectImporterService } from './importer.service';
import { ProjectsService } from '../projects/projects.service';
import { converterClient } from './converter.client';

const MAX_UPLOAD_BYTES = Number(process.env.MSPROJECT_MAX_UPLOAD_BYTES ?? 26 * 1024 * 1024);

/**
 * Microsoft Project import — two-phase and side-effect free until confirm:
 *   POST /api/msproject/import/analyze  (multipart file) → preview + token, changes nothing
 *   POST /api/msproject/import/commit   (token)           → atomic transactional import
 */
@Controller('msproject')
export class MsProjectController {
  constructor(
    private readonly importer: MsProjectImporterService,
    private readonly projectsService: ProjectsService,
  ) {}

  @Post('import/analyze')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  @HttpCode(200)
  async analyze(@UploadedFile() file: Express.Multer.File): Promise<unknown> {
    if (!file) {
      return { statusCode: 400, code: 'NO_FILE', message: 'Attach a .xml or .mpp file in the "file" part.' };
    }
    // Preview authorisation: resolves the workspace principal. When real
    // authentication lands, swap this for the request user — the rest of
    // the flow already scopes every write to the organization.
    const org = await this.projectsService.ensureDefaultOrg();
    const result = await this.importer.analyze(file);
    return { ...result, converterConfigured: converterClient.isConfigured() };
  }

  @Post('import/commit')
  async commit(@Body() dto: { token?: string; preserveDates?: boolean }): Promise<unknown> {
    if (!dto.token) {
      return { statusCode: 400, code: 'NO_TOKEN', message: 'Provide the analysis token.' };
    }
    const org = await this.projectsService.ensureDefaultOrg();
    const { projectId, name } = await this.importer.commit({ organizationId: org.id }, dto.token, {
      preserveDates: dto.preserveDates,
    });
    return { projectId, name, imported: true };
  }

  @Get('import/jobs')
  async jobs(): Promise<unknown> {
    const org = await this.projectsService.ensureDefaultOrg();
    return this.importer.listJobs({ organizationId: org.id });
  }

  @Get('import/status')
  status(): unknown {
    return {
      xml: true,
      mpp: converterClient.isConfigured(),
      maxUploadBytes: MAX_UPLOAD_BYTES,
      converterUrl: process.env.MSPROJECT_CONVERTER_URL ?? null,
    };
  }
}
