import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import { popupErrorDirective } from './error-dialog'

const app = createApp(App)
app.directive('popup-error', popupErrorDirective)
app.mount('#app')
