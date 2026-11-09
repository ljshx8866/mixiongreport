import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, Req } from '@nestjs/common';
import type { RequestWithUser } from '../auth';
import { HrOffboardingService } from './hr-offboarding.service';

@Controller('api/hr/offboarding')
export class HrOffboardingController {
  constructor(private readonly service: HrOffboardingService) {}

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
  @Post(':id/resubmit') resubmit(@Req() request: RequestWithUser,
    @Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    return this.service.resubmit(request.user, id, body);
  }
}
