import { Body, Controller, Get, Param, ParseIntPipe, Patch, Query, Req } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles, type RequestWithUser } from './auth';
import { SystemAlertService } from './system-alert.service';

@Controller('api/system-alerts')
@Roles(UserRole.ADMIN)
export class SystemAlertController {
  constructor(private readonly alerts: SystemAlertService) {}

  @Get()
  list(@Req() _request: RequestWithUser, @Query('status') status?: string,
    @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.alerts.list(status, page, pageSize);
  }

  @Patch(':id/status')
  setStatus(@Param('id', ParseIntPipe) id: number, @Body() body: { status?: unknown }) {
    return this.alerts.setStatus(id, body.status);
  }
}
