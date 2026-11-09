import { Body, Controller, Delete, Get, HttpException, Logger, Param, ParseIntPipe, Post, Query, Req } from '@nestjs/common';
import type { RequestWithUser } from '../auth';
import { HrOnboardingService } from './hr-onboarding.service';

@Controller('api/hr/onboarding')
export class HrOnboardingController {
  private readonly logger = new Logger(HrOnboardingController.name);
  constructor(private readonly service: HrOnboardingService) {}

  @Get() list(@Req() request: RequestWithUser, @Query('storeId') storeId?: string) {
    return this.service.list(request.user, storeId);
  }

  @Get('account-roles') accountRoles(@Req() request: RequestWithUser, @Query('storeId') storeId: string) {
    return this.service.accountRoles(request.user, storeId);
  }

  @Get('draft') getIntakeDraft(@Req() request: RequestWithUser, @Query('storeId') storeId: string) {
    return this.service.getIntakeDraft(request.user, storeId);
  }

  @Post('draft') saveIntakeDraft(@Req() request: RequestWithUser, @Body() body: Record<string, unknown>) {
    return this.service.saveIntakeDraft(request.user, body);
  }

  @Delete('draft') clearIntakeDraft(@Req() request: RequestWithUser, @Query('storeId') storeId: string) {
    return this.service.clearIntakeDraft(request.user, storeId);
  }

  @Post('employees/:employeeId/submit') submit(@Req() request: RequestWithUser,
    @Param('employeeId', ParseIntPipe) employeeId: number, @Body() body: Record<string, unknown>) {
    return this.service.submit(request.user, employeeId, body);
  }

  @Post('direct') async createAndSubmit(@Req() request: RequestWithUser, @Body() body: Record<string, unknown>) {
    try {
      return await this.service.createAndSubmit(request.user, body);
    } catch (error) {
      const status = error instanceof HttpException ? error.getStatus() : 500;
      const kind = error instanceof Error && /^[A-Za-z0-9_]{1,60}$/.test(error.name) ? error.name : 'Error';
      const code = typeof error === 'object' && error !== null && 'code' in error &&
        typeof (error as { code?: unknown }).code === 'string' && /^P\d{4}$/.test((error as { code: string }).code)
        ? `, prismaCode=${(error as { code: string }).code}` : '';
      this.logger.warn(`Direct onboarding failed (status=${status}, kind=${kind}${code})`);
      throw error;
    }
  }

  @Get(':id/history') history(@Req() request: RequestWithUser,
    @Param('id', ParseIntPipe) id: number) {
    return this.service.history(request.user, id);
  }

  @Post(':id/correct-phone') correctPhone(@Req() request: RequestWithUser,
    @Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    return this.service.correctPhoneAndResubmit(request.user, id, body);
  }

  @Post(':id/decisions') decide(@Req() request: RequestWithUser,
    @Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    return this.service.decide(request.user, id, body);
  }
}
