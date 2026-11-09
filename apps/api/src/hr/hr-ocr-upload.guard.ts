import { BadRequestException, CanActivate, ExecutionContext, ForbiddenException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { HrEmployeeStatus } from '@prisma/client';
import type { RequestWithUser } from '../auth';
import { PrismaService } from '../prisma.service';
import { HrAccessService } from './hr-access.service';
import { HrOcrCredentialsService } from './hr-ocr-credentials.service';

/** Guards before Multer reads image bytes; the service rechecks after upload. */
@Injectable()
export class HrOcrUploadGuard implements CanActivate {
  constructor(private readonly db: PrismaService, private readonly access: HrAccessService,
    private readonly credentials: HrOcrCredentialsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (process.env.HR_SENSITIVE_INTAKE_ENABLED !== 'true' || process.env.HR_OCR_ENABLED !== 'true')
      throw new ServiceUnavailableException('HR ID card recognition is not enabled');
    const request = context.switchToHttp().getRequest<RequestWithUser & {
      params: { id?: string }; query: { storeId?: string } }>();
    const employeeValue = Number(request.params?.id);
    if (Number.isSafeInteger(employeeValue) && employeeValue > 0) {
      const employee = await this.db.hrEmployee.findUnique({ where: { id: BigInt(employeeValue) },
        select: { status: true, initialStoreId: true } });
      if (!employee || employee.status !== HrEmployeeStatus.DRAFT || employee.initialStoreId == null)
        throw new ForbiddenException('HR access denied');
      await this.access.assertStorePermission(request.user, 'HR_ONBOARDING_CREATE', employee.initialStoreId);
    } else {
      const storeId = Number(request.query?.storeId);
      if (!Number.isSafeInteger(storeId) || storeId <= 0) throw new BadRequestException('Invalid store id');
      await this.access.assertStorePermission(request.user, 'HR_ONBOARDING_CREATE', BigInt(storeId));
    }
    await this.credentials.runtimeCredentials();
    return true;
  }
}
