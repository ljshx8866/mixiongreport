import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Req } from '@nestjs/common';
import type { RequestWithUser } from '../auth';
import { HrScheduleService } from './hr-schedule.service';
import { HrScheduleNotificationService } from './hr-schedule-notification.service';

@Controller('api/hr/schedules')
export class HrScheduleController {
  constructor(private readonly schedules: HrScheduleService,
    private readonly notifications: HrScheduleNotificationService) {}

  @Get() list(@Req() request: RequestWithUser,
    @Query('storeId') storeId: string, @Query('date') date: string) {
    return this.schedules.list(request.user, storeId, date);
  }

  @Get('notification-failures') notificationFailures(@Req() request: RequestWithUser,
    @Query('storeId') storeId: string, @Query('date') date: string) {
    return this.schedules.notificationFailures(request.user, storeId, date);
  }

  @Get('shift-templates') shiftTemplates(@Req() request: RequestWithUser,
    @Query('storeId') storeId: string) {
    return this.schedules.listShiftTemplates(request.user, storeId);
  }

  @Post('shift-templates') createShiftTemplate(@Req() request: RequestWithUser,
    @Body() body: Record<string, unknown>) {
    return this.schedules.createShiftTemplate(request.user, body);
  }

  @Patch('shift-templates/:id') updateShiftTemplate(@Req() request: RequestWithUser,
    @Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    return this.schedules.updateShiftTemplate(request.user, id, body);
  }

  @Delete('shift-templates/:id') deleteShiftTemplate(@Req() request: RequestWithUser,
    @Param('id', ParseIntPipe) id: number) {
    return this.schedules.deleteShiftTemplate(request.user, id);
  }

  @Get('points') points(@Req() request: RequestWithUser, @Query('storeId') storeId: string) {
    return this.schedules.listPoints(request.user, storeId);
  }

  @Post('points') createPoint(@Req() request: RequestWithUser, @Body() body: Record<string, unknown>) {
    return this.schedules.createPoint(request.user, body);
  }

  @Patch('points/:id') updatePoint(@Req() request: RequestWithUser,
    @Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    return this.schedules.updatePoint(request.user, id, body);
  }

  @Delete('points/:id') deletePoint(@Req() request: RequestWithUser,
    @Param('id', ParseIntPipe) id: number) {
    return this.schedules.deletePoint(request.user, id);
  }

  @Post() create(@Req() request: RequestWithUser, @Body() body: Record<string, unknown>) {
    return this.schedules.create(request.user, body);
  }

  @Post('batch') createBatch(@Req() request: RequestWithUser, @Body() body: Record<string, unknown>) {
    return this.schedules.createBatch(request.user, body);
  }

  @Post('publish-batch') publishBatch(@Req() request: RequestWithUser, @Body() body: Record<string, unknown>) {
    return this.schedules.publishBatch(request.user, body);
  }

  @Patch(':id') revise(@Req() request: RequestWithUser,
    @Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    return this.schedules.revise(request.user, id, body);
  }

  @Post(':id/cancel') cancelDraft(@Req() request: RequestWithUser,
    @Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    return this.schedules.cancelDraft(request.user, id, body.expectedVersion);
  }

  @Post(':id/publish') publish(@Req() request: RequestWithUser,
    @Param('id', ParseIntPipe) id: number) {
    return this.schedules.publish(request.user, id);
  }

  @Post(':id/notification/retry') retryNotification(@Req() request: RequestWithUser,
    @Param('id', ParseIntPipe) id: number) {
    return this.notifications.retry(request.user, id);
  }
}
