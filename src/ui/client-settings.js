import { saveTextFile, pickTextFile, flushStorage, nativeRuntime } from '../platform/runtime.js';
import { SCENE_LABELS, COMPANION_MODES, modelEntry, newId } from '../engine/client.js';
import { loadPreferences, savePreferences, loadCompanion, saveCompanion, loadModels, saveModels } from '../storage/client.js';
import { createBackup, parseBackup, restoreBackup } from '../storage/backup.js';
import { initAppearance } from './appearance.js';
import { SCENE_PATHS } from '../content/scenes.js';
import { localMediaUrl } from '../platform/media.js';
import { initSpeechSettings } from './speech.js';
import { CET6_DICTIONARY_LICENSE } from '../content/cet6-words.js';

export async function downloadFile(name, content, type = 'application/json') {
  return saveTextFile(name, content, type);
}

export function initClientSettings({ legacy, notify, isBusy, onModel, beforeRestore }) {
  const $ = id=>document.getElementById(id);
  $('dictionary-license').textContent = CET6_DICTIONARY_LICENSE;
  if (nativeRuntime()) {
    $('model-storage-hint').textContent = '选择服务商预设，或填写自定义接口。Key 加密保存在本机，并随请求发送给你配置的端点。';
    $('data-storage-hint').textContent = '聊天和学习记录保存在本机。卸载应用、清除应用数据或换设备前，请先导出备份。回收站可在对话列表中打开。';
  }
  let preferences, companion, models;
  try { preferences=loadPreferences(); companion=loadCompanion(); models=loadModels(legacy); }
  catch(error) { notify(error.message); throw error; }
  let editing = structuredClone(models), selected=editing.activeId, backup=null;
  const appearance=initAppearance({getPreferences:()=>preferences,status:$('scene-status')});
  const speech = initSpeechSettings({ getPreferences:()=>preferences, save:next=>{savePreferences(next);preferences=loadPreferences();}, notify });
  const option = (value,text)=>{const node=document.createElement('option');node.value=value;node.textContent=text;return node;};
  const fieldMap={scene:'set-scene',theme:'set-theme',font:'set-font',motion:'set-motion',enterSend:'set-enter-send'};
  for (const [key,id] of Object.entries(fieldMap)) {
    const input=$(id); if(input.type==='checkbox') input.checked=preferences[key]; else input.value=preferences[key];
    input.addEventListener('change',()=>{
      const next={...preferences,[key]:input.type==='checkbox'?input.checked:input.value};
      try { savePreferences(next); preferences=next; appearance.sync(); syncScene(); }
      catch(error){if(input.type==='checkbox') input.checked=preferences[key];else input.value=preferences[key];notify(error.message);}
    });
  }
  function syncScene(){for(const b of $('scene-previews').children)b.setAttribute('aria-pressed',String(b.dataset.scene===preferences.scene));}
  for (const scene of ['dawn','day','dusk','night']) {
    const b=document.createElement('button');b.type='button';b.dataset.scene=scene;
    const img=document.createElement('img');img.src=localMediaUrl(SCENE_PATHS[scene]);img.alt='';
    const label=document.createElement('span');label.textContent=SCENE_LABELS[scene];b.append(img,label);
    b.addEventListener('click',()=>{$('set-scene').value=scene;$('set-scene').dispatchEvent(new Event('change'));});$('scene-previews').append(b);
  }
  syncScene();
  const tabs=[...document.querySelectorAll('[data-settings-tab]')];
  function showTab(key){for(const tab of tabs){const active=tab.dataset.settingsTab===key;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;$(tab.getAttribute('aria-controls')).hidden=!active;}document.querySelector('#settings .settings-content').scrollTop=0;}
  tabs.forEach((tab,i)=>{tab.addEventListener('click',()=>showTab(tab.dataset.settingsTab));tab.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const at=event.key==='Home'?0:event.key==='End'?tabs.length-1:(i+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;tabs[at].click();tabs[at].focus();});});
  showTab('general');
  function readModel(){return modelEntry({id:selected,name:$('set-model-name').value,profile:{endpoint:$('endpoint').value.trim(),model:$('model').value.trim(),apiKey:$('apiKey').value.trim(),provider:$('set-provider').value,cacheMode:$('set-cache-mode').value,stream:$('set-stream').checked,temperature:$('set-temperature').value,timeoutMs:Number($('set-timeout').value)*1000,
    apiFormat:$('set-api-format').value,authMode:$('set-auth-mode').value,sendTemperature:$('set-send-temperature').checked,streamUsage:$('set-stream-usage').checked,jsonMode:$('set-json-mode').value,tokenField:$('set-token-field').value}});}
  function capture(){editing.entries=editing.entries.map(e=>e.id===selected?readModel():e);}
  function fillModel(){const entry=editing.entries.find(e=>e.id===selected);const p=entry.profile;
    $('set-model-entry').replaceChildren(...editing.entries.map(e=>option(e.id,e.name)));$('set-model-entry').value=selected;
    $('set-model-name').value=entry.name;for(const id of ['endpoint','model','apiKey'])$(id).value=p[id];
    $('set-provider').value=p.provider;$('set-cache-mode').value=p.cacheMode;$('set-stream').checked=p.stream;$('set-temperature').value=p.temperature;$('set-timeout').value=p.timeoutMs/1000;
    $('set-api-format').value=p.apiFormat;$('set-auth-mode').value=p.authMode;$('set-send-temperature').checked=p.sendTemperature;$('set-stream-usage').checked=p.streamUsage;$('set-json-mode').value=p.jsonMode;$('set-token-field').value=p.tokenField;
    $('set-api-format').dispatchEvent(new Event('change'));
    $('endpoint').dispatchEvent(new Event('input'));$('test-result').textContent='';$('preset').value='custom';
  }
  $('set-model-entry').addEventListener('change',()=>{capture();selected=$('set-model-entry').value;fillModel();});
  function addModel(copy){if(editing.entries.length>=30){notify('最多保存 30 个模型配置。');return;}capture();const entry=copy?modelEntry({...readModel(),id:newId('model'),name:readModel().name+' 副本'}):modelEntry({id:newId('model'),name:'新的配置'});editing.entries.push(entry);selected=entry.id;fillModel();}
  $('btn-add-model').addEventListener('click',()=>addModel(false));$('btn-copy-model').addEventListener('click',()=>addModel(true));
  $('btn-delete-model').addEventListener('click',()=>{if(editing.entries.length===1){notify('请至少保留一个配置。');return;}editing.entries=editing.entries.filter(e=>e.id!==selected);selected=editing.entries[0].id;fillModel();});
  function syncChat(modelId, config){const selectedModel=models.entries.find(e=>e.id===modelId)||models.entries.find(e=>e.id===models.activeId)||models.entries[0];$('chat-model').replaceChildren(...models.entries.map(e=>option(e.id,e.name)));$('chat-model').value=selectedModel.id;$('chat-model').disabled=isBusy();$('chat-companion').textContent=COMPANION_MODES[config?.mode||companion.mode];return selectedModel;}
  $('chat-model').addEventListener('change',()=>{if(isBusy())return;const entry=models.entries.find(e=>e.id===$('chat-model').value);try{onModel(entry);}catch(error){notify(error.message);}});
  $('btn-backup').addEventListener('click', async () => {
    try {
      if (isBusy()) throw new Error('请等当前回复或评价结束。');
      if (!beforeRestore()) return;
      const data = createBackup();
      const saved = await downloadFile(`梦鲸备份-${new Date().toISOString().slice(0,10)}.json`, JSON.stringify(data,null,2));
      $('backup-status').textContent = saved ? '备份已导出，请在保存位置确认文件。' : '已取消导出。';
    } catch (error) { $('backup-status').textContent = error.message; }
  });
  $('btn-pick-backup').addEventListener('click', async () => {
    backup = null; $('backup-preview').hidden = true;
    try {
      const text = await pickTextFile(64 * 1024 * 1024);
      if (text === null) return;
      backup = parseBackup(text);
      const rounds = backup.learning.pausedRounds.length + Number(backup.learning.round?.finishedAt === null);
      $('backup-summary').textContent = `包含 ${backup.chats.length} 段对话、${backup.learning.events.length} 次作答、${rounds} 组未完成练习、${backup.learning.favorites.length} 个收藏、${backup.models.length} 个模型配置。相同记录不会重复计入，现有练习优先保留，冲突对话会另存副本。`;
      $('backup-preview').hidden = false; $('backup-status').textContent = '校验通过，可以导入。';
    } catch (error) { $('backup-status').textContent = '未导入：' + error.message; }
  });
  $('btn-import-backup').addEventListener('click', async () => {
    try {
      if (!backup) return;
      if (isBusy()) throw new Error('请等当前回复或评价结束。');
      if (!beforeRestore()) return;
      const result = restoreBackup(backup, { includeSettings: $('backup-settings').checked });
      await flushStorage();
      backup = null; $('backup-preview').hidden = true;
      $('backup-status').textContent = `已导入 ${result.chats} 段对话、${result.events} 次作答、${result.rounds} 组未完成练习。正在重新打开页面…`;
      setTimeout(() => location.reload(), 900);
    } catch (error) { $('backup-status').textContent = '导入未完成：' + error.message; }
  });
  return {
    preferences:()=>preferences, companion:()=>companion, models:()=>models, appearance, showTab,
    readProfile:()=>readModel().profile,
    profile:(id)=> (models.entries.find(e=>e.id===id)||models.entries.find(e=>e.id===models.activeId)||models.entries[0]).profile,
    activeId:()=>models.activeId, syncChat,
    open(current){speech.open();editing=structuredClone(models);selected=models.entries.some(e=>e.id===current?.modelId)?current.modelId:models.activeId;fillModel();const config=current?.assistantConfig||companion;$('set-companion-mode').value=config.mode;$('set-companion-instructions').value=config.instructions||'';$('set-companion-memory').value=config.memory||'';},
    save(){capture();editing.activeId=selected;saveModels(editing);models=structuredClone(editing);const next={mode:$('set-companion-mode').value,instructions:$('set-companion-instructions').value,memory:$('set-companion-memory').value};saveCompanion(next);companion=next;speech.save();return {modelId:selected,assistantConfig:next,profile:readModel().profile};},
  };
}
