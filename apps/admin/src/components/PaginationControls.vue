<script setup lang="ts">
defineProps<{ page: number; total: number; pageSize?: number; always?: boolean }>()
const emit = defineEmits<{
  'update:page': [page: number]
  'update:pageSize': [pageSize: number]
}>()
function changePageSize(event: Event) {
  const value = Number((event.target as HTMLSelectElement).value)
  if ([10, 20, 50, 100].includes(value)) {
    emit('update:pageSize', value)
    emit('update:page', 1)
  }
}
</script>

<template>
  <nav v-if="always || total > 0" class="pagination-controls" aria-label="列表分页">
    <span>共 {{ total }} 条 · 第 {{ page }} / {{ Math.max(1, Math.ceil(total / (pageSize ?? 20))) }} 页</span>
    <div class="pagination-actions">
      <label>每页
        <select :value="pageSize ?? 20" aria-label="每页显示条数" @change="changePageSize">
          <option :value="10">10 条</option>
          <option :value="20">20 条</option>
          <option :value="50">50 条</option>
          <option :value="100">100 条</option>
        </select>
      </label>
      <button type="button" :disabled="page <= 1" @click="emit('update:page', page - 1)">上一页</button>
      <button type="button" :disabled="page >= Math.ceil(total / (pageSize ?? 20))" @click="emit('update:page', page + 1)">下一页</button>
    </div>
  </nav>
</template>

<style scoped>
.pagination-controls{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 0;color:#667085;font-size:13px}.pagination-actions{display:flex;align-items:center;gap:8px}.pagination-actions label{display:flex;align-items:center;gap:6px}.pagination-actions select,.pagination-controls button{min-height:34px;padding:5px 10px;border:1px solid #d7dee8;border-radius:8px;background:#fff;color:#344054}.pagination-controls button{padding:5px 12px;cursor:pointer}.pagination-controls button:disabled{opacity:.45;cursor:not-allowed}
</style>
