import { BadRequestException, ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { HrEmployeeStatus } from '@prisma/client';
import type { AuthContext } from '../auth';
import { PrismaService } from '../prisma.service';
import { createAliyunIdcardOcrProviderFromCredentials } from './aliyun-idcard-ocr.provider';
import { HrOcrCredentialsService } from './hr-ocr-credentials.service';
import { HrAccessService } from './hr-access.service';
import type { OcrDocumentInput, OcrProvider } from './ocr-provider';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function validateIdcardImage(input: OcrDocumentInput): void {
  const bytes = Buffer.from(input.content);
  if (!bytes.length || bytes.length > 10 * 1024 * 1024)
    throw new BadRequestException('ID card image must be at most 10 MB');
  const jpeg = input.mimeType === 'image/jpeg' && bytes.length >= 4 &&
    bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = input.mimeType === 'image/png' && bytes.length >= PNG.length &&
    bytes.subarray(0, PNG.length).equals(PNG);
  if (!jpeg && !png) throw new BadRequestException('ID card image format does not match JPEG or PNG');
  if (input.documentType !== 'ID_CARD_FRONT' && input.documentType !== 'ID_CARD_BACK')
    throw new BadRequestException('Unsupported ID card side');
}

@Injectable()
export class HrOcrPreviewService {
  constructor(private readonly db: PrismaService, private readonly access: HrAccessService,
    private readonly credentials: HrOcrCredentialsService) {}

  protected async provider(): Promise<OcrProvider> {
    return createAliyunIdcardOcrProviderFromCredentials(await this.credentials.runtimeCredentials());
  }

  async preview(employeeId: bigint, user: AuthContext | undefined, input: OcrDocumentInput) {
    if (process.env.HR_SENSITIVE_INTAKE_ENABLED !== 'true' || process.env.HR_OCR_ENABLED !== 'true')
      throw new ServiceUnavailableException('HR ID card recognition is not enabled');
    if (employeeId <= 0n) throw new BadRequestException('Invalid employee id');
    const employee = await this.db.hrEmployee.findUnique({ where: { id: employeeId },
      select: { status: true, initialStoreId: true } });
    if (!employee || employee.status !== HrEmployeeStatus.DRAFT || employee.initialStoreId == null)
      throw new ConflictException('Only a scoped employee draft accepts ID card recognition');
    await this.access.assertStorePermission(user, 'HR_ONBOARDING_CREATE', employee.initialStoreId);
    validateIdcardImage(input);
    const result = await (await this.provider()).recognize(input);
    // Return only allowed structured fields. No original image or vendor payload is retained.
    return { provider: result.provider, providerResultId: result.providerResultId, fields: result.fields,
      requiresManualConfirmation: true };
  }

  async previewForStore(storeId: bigint, user: AuthContext | undefined, input: OcrDocumentInput) {
    if (process.env.HR_SENSITIVE_INTAKE_ENABLED !== 'true' || process.env.HR_OCR_ENABLED !== 'true')
      throw new ServiceUnavailableException('HR ID card recognition is not enabled');
    if (storeId <= 0n) throw new BadRequestException('Invalid store id');
    await this.access.assertStorePermission(user, 'HR_ONBOARDING_CREATE', storeId);
    validateIdcardImage(input);
    const result = await (await this.provider()).recognize(input);
    return { provider: result.provider, providerResultId: result.providerResultId, fields: result.fields,
      requiresManualConfirmation: true };
  }
}
