import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, Req } from '@nestjs/common';
import type { RequestWithUser } from '../auth';
import { HrTimeService } from './hr-time.service';

@Controller('api/hr/timesheets')
export class HrTimeController {
  constructor(private readonly time: HrTimeService) {}

  @Get() listDay(@Req() request: RequestWithUser,
    @Query('storeId') storeId: string, @Query('date') date: string) {
    return this.time.listDay(request.user, storeId, date);
  }

  @Get('statistics') statistics(@Req() request: RequestWithUser,
    @Query('storeId') storeId: string, @Query('startDate') startDate: string,
    @Query('endDate') endDate: string, @Query('employeeId') employeeId?: string) {
    return this.time.statistics(request.user, storeId, startDate, endDate, employeeId);
  }

  @Get('daily-summary') dailySummary(@Req() request: RequestWithUser,
    @Query('employeeId') employeeId: string, @Query('date') date: string) {
    return this.time.dailySummary(request.user, employeeId, date);
  }

  @Post('confirm-store-day') confirmStoreDay(@Req() request: RequestWithUser,
    @Body() body: Record<string, unknown>) {
    return this.time.confirmStoreDay(request.user, body);
  }

  @Post('confirm-day') confirmDay(@Req() request: RequestWithUser,
    @Body() body: Record<string, unknown>) {
    return this.time.confirmDay(request.user, body);
  }

  @Post('schedules/:scheduleId/confirm') confirm(@Req() request: RequestWithUser,
    @Param('scheduleId', ParseIntPipe) scheduleId: number, @Body() body: Record<string, unknown>) {
    return this.time.confirm(request.user, scheduleId, body);
  }
}
