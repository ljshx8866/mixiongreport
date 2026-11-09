import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import OcrApi, { RecognizeIdcardRequest } from '@alicloud/ocr-api20210707';
import { $OpenApiUtil } from '@alicloud/openapi-core';
import { Readable } from 'node:stream';
import type { OcrDocumentInput, OcrProvider, OcrRecognition } from './ocr-provider';
import type { AliyunOcrCredentials } from './hr-ocr-credential-crypto';

type AliyunIdcardClient = (image: Uint8Array) => Promise<unknown>;

const fieldsBySide = {
  ID_CARD_FRONT: ['name', 'sex', 'ethnicity', 'birthDate', 'address', 'idNumber'],
  ID_CARD_BACK: ['issueAuthority', 'validPeriod'],
} as const;

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function aliyunFailureMessage(code: unknown): string {
  if (code === 'noPermission')
    return '阿里云 OCR 未授权，请检查 RAM 权限 ocr:RecognizeIdcard，并确认身份证识别服务已开通';
  if (code === 'ocrServiceNotOpen')
    return '阿里云身份证识别服务尚未开通，请在 OCR 控制台开通对应服务';
  if (code === 'InvalidAccessKeyId' || code === 'InvalidAccessKeyId.NotFound')
    return '阿里云 AccessKey 无效，请检查后台配置';
  if (code === 'SignatureDoesNotMatch')
    return '阿里云 AccessKey Secret 校验失败，请重新配置密钥';
  if (code === 'illegalImageContent' || code === 'imageUrlOrBodyEmpty')
    return '阿里云未收到有效图片内容，请重新上传身份证照片';
  if (code === 'unsupportedImageFormat' || code === 'unmatchedImageType' || code === 'illegalImageSize')
    return '阿里云不支持当前图片格式或尺寸，请上传清晰的身份证照片';
  if (typeof code === 'string' && /^(InvalidImage|InvalidParameter|InvalidContent)/.test(code))
    return '阿里云无法识别该图片，请检查身份证正反面和图片质量';
  return '身份证识别服务暂不可用，请稍后重试';
}

function aliyunErrorCode(error: unknown): string | null {
  const value = object(error);
  const data = object(value.data);
  const body = object(data.body);
  const candidates = [value.code, value.Code, data.code, data.Code, body.code, body.Code];
  return candidates.find((candidate): candidate is string =>
    typeof candidate === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(candidate)) ?? null;
}

/** Maps RecognizeIdcard's Data JSON without retaining the image or raw response. */
export function parseAliyunIdcardResult(response: unknown, side: keyof typeof fieldsBySide): OcrRecognition {
  const sdkResponse = object(response);
  const envelope = sdkResponse.body == null ? sdkResponse : object(sdkResponse.body);
  const statusCode = sdkResponse.statusCode;
  const code = envelope.Code ?? envelope.code;
  if ((typeof statusCode === 'number' && (statusCode < 200 || statusCode >= 300)) ||
      (typeof code === 'string' && code && code !== '200'))
    throw new ServiceUnavailableException(aliyunFailureMessage(code));
  let data: unknown = envelope.Data ?? envelope.data;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); }
    catch { throw new ServiceUnavailableException('Invalid ID card recognition result'); }
  }
  const sideResult = object(object(object(data).data)[side === 'ID_CARD_FRONT' ? 'face' : 'back']);
  const values = object(sideResult.data);
  if (!Object.keys(values).length) throw new ServiceUnavailableException('ID card side was not recognized');
  const confidence = new Map<string, number>();
  for (const entry of Array.isArray(sideResult.prism_keyValueInfo) ? sideResult.prism_keyValueInfo : []) {
    const item = object(entry);
    if (typeof item.key === 'string' && typeof item.valueProb === 'number')
      confidence.set(item.key, Math.max(0, Math.min(1, item.valueProb / 100)));
  }
  const fields: OcrRecognition['fields'] = {};
  for (const key of fieldsBySide[side]) {
    if (typeof values[key] === 'string' && values[key].trim())
      fields[key] = { value: values[key].trim(), confidence: confidence.get(key) ?? null };
  }
  if (!Object.keys(fields).length) throw new ServiceUnavailableException('ID card fields were not recognized');
  return {
    provider: 'ALIYUN_RECOGNIZE_IDCARD',
    providerResultId: typeof (envelope.RequestId ?? envelope.requestId) === 'string'
      ? (envelope.RequestId ?? envelope.requestId) as string : null,
    fields,
  };
}

/** The official SDK accepts a binary stream; no public image URL is created. */
export function createAliyunIdcardOcrProvider(client: Pick<OcrApi, 'recognizeIdcard'>): AliyunIdcardOcrProvider {
  return new AliyunIdcardOcrProvider((image) => client.recognizeIdcard(
    new RecognizeIdcardRequest({ body: Readable.from([Buffer.from(image)]) }),
  ));
}

/** Credentials are decrypted by the server from the protected admin configuration record. */
export function createAliyunIdcardOcrProviderFromCredentials(
  credentials: AliyunOcrCredentials,
): AliyunIdcardOcrProvider {
  const client = new OcrApi(new $OpenApiUtil.Config({
    accessKeyId: credentials.accessKeyId, accessKeySecret: credentials.accessKeySecret,
    endpoint: 'ocr-api.cn-hangzhou.aliyuncs.com',
    protocol: 'HTTPS',
    regionId: 'cn-hangzhou',
    connectTimeout: 5000,
    readTimeout: 15000,
  }));
  return createAliyunIdcardOcrProvider(client);
}

/** Inject the official Alibaba Cloud SDK call once service credentials are configured. */
export class AliyunIdcardOcrProvider implements OcrProvider {
  constructor(private readonly callRecognizeIdcard: AliyunIdcardClient) {}

  async recognize(input: OcrDocumentInput): Promise<OcrRecognition> {
    if (input.documentType !== 'ID_CARD_FRONT' && input.documentType !== 'ID_CARD_BACK')
      throw new BadRequestException('Unsupported document type');
    if (!['image/jpeg', 'image/png'].includes(input.mimeType) || !input.content.length || input.content.length > 10 * 1024 * 1024)
      throw new BadRequestException('ID card image must be JPEG or PNG, at most 10 MB');
    let response: unknown;
    try { response = await this.callRecognizeIdcard(input.content); }
    catch (error) { throw new ServiceUnavailableException(aliyunFailureMessage(aliyunErrorCode(error))); }
    return parseAliyunIdcardResult(response, input.documentType);
  }
}
