import { Body, Controller, Get, Put } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from './auth';
import { PasswordPolicyService } from './password-policy.service';

@Controller('api/system-settings/password-policy')
@Roles(UserRole.ADMIN)
export class PasswordPolicyController {
  constructor(private readonly policy: PasswordPolicyService) {}

  @Get()
  async get() {
    const policy = await this.policy.get();
    return { enabled: policy.enabled, defaultPasswordConfigured: Boolean(policy.defaultPasswordHash) };
  }

  @Put()
  update(@Body() body: Record<string, unknown>) {
    return this.policy.update(body.enabled as boolean, body.defaultPassword as string | undefined);
  }
}
