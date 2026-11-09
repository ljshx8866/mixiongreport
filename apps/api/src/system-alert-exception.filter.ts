import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { alertFingerprint, cleanAlertMessage, diagnoseAlert } from './system-alert-diagnostics';

type HttpRequest = { method?: string; path?: string; route?: { path?: string } };
type HttpResponse = { headersSent?: boolean; status(code: number): HttpResponse; json(body: unknown): void };

@Catch()
@Injectable()
export class SystemAlertExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(SystemAlertExceptionFilter.name);
  constructor(private readonly db: PrismaService) {}

  async catch(exception: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const request = context.getRequest<HttpRequest>();
    const response = context.getResponse<HttpResponse>();
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const route = String(request.route?.path ?? request.path ?? '/').split('?')[0].slice(0, 191);
    const method = String(request.method ?? 'GET').slice(0, 12).toUpperCase();
    const rawResponse = exception instanceof HttpException ? exception.getResponse() : undefined;
    const rawMessage = typeof rawResponse === 'string'
      ? rawResponse
      : rawResponse && typeof rawResponse === 'object' && 'message' in rawResponse
        ? (rawResponse as { message?: unknown }).message
        : exception instanceof Error ? exception.message : exception;
    const message = cleanAlertMessage(Array.isArray(rawMessage) ? rawMessage.join('; ') : rawMessage);

    if (status >= 500) {
      this.logger.error(`${method} ${route} returned HTTP ${status}: ${message}`);
      const diagnosis = diagnoseAlert(message, status);
      const fingerprint = alertFingerprint('HTTP', method, route, status, message);
      try {
        await this.db.systemAlert.upsert({
          where: { fingerprint },
          create: { fingerprint, source: 'HTTP', severity: 'ERROR', status: 'OPEN', title: diagnosis.title,
            message, route, method, httpStatus: status, suggestion: diagnosis.suggestion },
          update: { lastSeenAt: new Date(), occurrenceCount: { increment: 1 }, status: 'OPEN', suggestion: diagnosis.suggestion },
        });
      } catch (writeError) {
        this.logger.error(`Could not save HTTP alert: ${writeError instanceof Error ? writeError.message : String(writeError)}`);
      }
    }

    if (response.headersSent) return;
    if (exception instanceof HttpException) {
      response.status(status).json(rawResponse);
      return;
    }
    response.status(status).json({ statusCode: status, message: '服务器暂时异常，请稍后重试。', error: 'Internal Server Error' });
  }
}
