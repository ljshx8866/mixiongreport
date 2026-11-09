import { ConflictException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Prisma } from '@prisma/client';

export async function assertHrLinkedAccountRemovable(tx: Prisma.TransactionClient, userId: bigint) {
  const account = await tx.user.findUnique({ where: { id: userId },
    select: { id: true, name: true, mobile: true, role: true, source: true, status: true } });
  if (!account) return null;
  if (account.source === 'POS' && account.status)
    throw new ConflictException('该账号仍由 POS 启用，请先在 POS 停用；也可以取消删除账号选项');
  if (account.role === UserRole.ADMIN && account.status &&
      await tx.user.count({ where: { role: UserRole.ADMIN, status: true } }) <= 1)
    throw new ConflictException('不能删除最后一个启用中的管理员账号');
  return account;
}

export async function deleteHrLinkedAccount(tx: Prisma.TransactionClient, userId: bigint): Promise<boolean> {
  const account = await assertHrLinkedAccountRemovable(tx, userId);
  if (!account) return false;
  await tx.userStore.deleteMany({ where: { userId } });
  await tx.fillReminderRecipient.deleteMany({ where: { userId } });
  await tx.storeDailyInput.updateMany({ where: { submittedBy: userId }, data: { submittedBy: null } });
  await tx.auditLog.updateMany({ where: { userId }, data: { userId: null } });
  await tx.user.delete({ where: { id: userId } });
  await tx.auditLog.create({ data: { userId: null, entityType: 'USER', entityId: userId,
    action: 'DELETE_HR_LINKED_ACCOUNT', beforeData: { name: account.name, mobile: account.mobile,
      role: account.role, source: account.source, status: account.status } } });
  return true;
}
