import { BadRequestException, Body, Controller, Get, Param, ParseIntPipe, Post, Req } from '@nestjs/common';
import type { RequestWithUser } from '../auth';
import { HrSensitiveDraftService } from './hr-sensitive-draft.service';

function employeeId(value: number): bigint {
  if (!Number.isSafeInteger(value) || value <= 0) throw new BadRequestException('Invalid employee id');
  return BigInt(value);
}

/** Structured draft fields only; no image upload or plaintext read route. */
@Controller('api/hr/employees/:id/sensitive-drafts')
export class HrSensitiveDraftController {
  constructor(private readonly drafts: HrSensitiveDraftService) {}

  @Get() masked(@Req() request: RequestWithUser, @Param('id', ParseIntPipe) id: number) {
    return this.drafts.masked(employeeId(id), request.user);
  }

  @Post('identity') saveIdentity(@Req() request: RequestWithUser,
    @Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    return this.drafts.saveIdentity(employeeId(id), request.user, body);
  }

  @Post('bank') saveBank(@Req() request: RequestWithUser,
    @Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    return this.drafts.saveBank(employeeId(id), request.user, body);
  }
}
