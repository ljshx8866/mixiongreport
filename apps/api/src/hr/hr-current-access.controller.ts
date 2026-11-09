import { Controller, Get, Req } from '@nestjs/common';
import type { RequestWithUser } from '../auth';
import { HrAccessService } from './hr-access.service';

@Controller('api/hr/current-access')
export class HrCurrentAccessController {
  constructor(private readonly access: HrAccessService) {}

  @Get() current(@Req() request: RequestWithUser) {
    return this.access.currentAccess(request.user);
  }
}
