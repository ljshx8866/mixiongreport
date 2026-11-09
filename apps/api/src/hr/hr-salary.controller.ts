import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, Req } from '@nestjs/common';
import type { RequestWithUser } from '../auth';
import { HrSalaryService } from './hr-salary.service';

@Controller('api/hr/salary-changes')
export class HrSalaryController {
  constructor(private readonly service: HrSalaryService) {}
  @Get('employees') employees(@Req() request: RequestWithUser, @Query('storeId') storeId: string) {
    return this.service.employeesForRequest(request.user, storeId);
  }
  @Get() list(@Req() request: RequestWithUser, @Query('storeId') storeId?: string) {
    return this.service.list(request.user, storeId);
  }
  @Post() submit(@Req() request: RequestWithUser, @Body() body: Record<string, unknown>) {
    return this.service.submit(request.user, body);
  }
  @Post(':id/decisions') decide(@Req() request: RequestWithUser,
    @Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    return this.service.decide(request.user, id, body);
  }
}
