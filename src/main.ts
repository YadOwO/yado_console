import './app.css';

import { mount } from 'svelte';

import App from './App.svelte';

/** 挂载管理端；index.html 中一定有 #app */
const target = document.getElementById('app');
if (target === null) {
  throw new Error('缺少 #app 挂载点');
}

export default mount(App, { target });
