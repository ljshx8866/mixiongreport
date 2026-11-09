import { Body, Controller, Get, Patch, Put, Req } from '@nestjs/common';
import type { RequestWithUser } from '../auth';
import { HrOcrCredentialsService } from './hr-ocr-credentials.service';

@Controller('api/hr/ocr-credentials')
export class HrOcrCredentialsController {
  constructor(private readonly credentials: HrOcrCredentialsService) {}

  @Get() status(@Req() request: RequestWithUser) {
    return this.credentials.status(request.user);
  }

  @Put() save(@Req() request: RequestWithUser, @Body() body: Record<string, unknown>) {
    return this.credentials.save(request.user, body);
  }

  @Patch('enabled') setEnabled(@Req() request: RequestWithUser, @Body() body: { enabled?: unknown }) {
    return this.credentials.setEnabled(request.user, body.enabled);
  }
}
