import { tr, type Lang } from '../i18n';
import { useEffect, useState } from 'react';
import { preferencesKV } from '../storage/kv';
import { loadComputerSettings, saveComputerSettings, DEFAULT_COMPUTER_URL, type ComputerSettings } from '../settings';
import { ResearchOsClient, describeError } from '../api/computer';
import { DEMO_LABEL, demoSource } from '../demo/demo';
import { UpdateCard } from './UpdateCard';
import { DEFAULT_MODEL_SETTINGS, clearKey, hasKey, loadKey, loadModelSettings, saveKey, saveModelSettings, type KeyHeader, type ModelSettings } from '../model/settings';
import { chat, describeModelError } from '../model/direct';

export function SettingsScreen({ demo, onDemo, lang, onLang, onComputer }: { demo: boolean; onDemo: (on: boolean) => void; lang: Lang; onLang: (l: Lang) => void; onComputer?: (enabled: boolean) => void }) {
  const [computer, setComputer] = useState<ComputerSettings>({ enabled: false, url: DEFAULT_COMPUTER_URL });
  useEffect(() => { void loadComputerSettings(preferencesKV).then(setComputer); }, []);
  async function updateComputer(next: ComputerSettings) { setComputer(next); await saveComputerSettings(preferencesKV, next); onComputer?.(next.enabled); }
  async function testComputer() {
    setStatus(tr('正在连接电脑,最多等 5 秒…'));
    try { const h = await new ResearchOsClient(computer.url, undefined, 5000).health(); setStatus(tr('电脑已连接：{0}。', h.status === 'ok' ? tr('正常') : h.status)); }
    catch (e) { setStatus(describeError(e)); }
  }
  const [status, setStatus] = useState('');
  const [ms, setMs] = useState<ModelSettings>(DEFAULT_MODEL_SETTINGS);
  const [key, setKey] = useState('');
  const [keyOnPhone, setKeyOnPhone] = useState(false);
  useEffect(() => { void loadModelSettings(preferencesKV).then(setMs); void hasKey(preferencesKV).then(setKeyOnPhone); }, []);
  async function saveModel() {
    await saveModelSettings(preferencesKV, ms);
    if (key.trim()) { await saveKey(preferencesKV, key); setKeyOnPhone(true); }
    setKey('');
    setStatus(tr('已保存在这台手机上。密钥不会发给电脑,也不会显示出来。'));
  }
  async function removeKey() { await clearKey(preferencesKV); setKeyOnPhone(false); setStatus(tr('已从这台手机删除模型密钥,现在用规则模式。')); }
  async function testModel() {
    setStatus(tr('正在测试模型连接…'));
    try {
      await saveModelSettings(preferencesKV, ms);
      await chat(await loadModelSettings(preferencesKV), await loadKey(preferencesKV), [{ role: 'user', content: 'ping' }]);
      setStatus(tr('模型连接正常。'));
    } catch (e) { setStatus(describeModelError(e)); }
  }


  return (
    <section>
      <h1>{tr('设置')}</h1>
      <div className="card" data-testid="lang-switch">
        <div><b>{tr('界面语言')}</b></div>
        <div className="row" role="radiogroup" aria-label={tr('界面语言')}>
          <button type="button" role="radio" aria-checked={lang === 'zh'} className="ghost" onClick={() => onLang('zh')}>中文</button>
          <button type="button" role="radio" aria-checked={lang === 'en'} className="ghost" onClick={() => onLang('en')}>English</button>
        </div>
        <div className="muted">{tr('默认中文;只由这里决定,不跟随手机语言。')}</div>
      </div>
      <div className="card">
        <label className="row"><input type="checkbox" style={{ width: 'auto' }} checked={demo} onChange={e => onDemo(e.target.checked)} aria-label={tr('演示模式')} /> {tr('演示模式(')}{tr(DEMO_LABEL)})</label>
        <div className="muted">{tr('显示一篇公开论文(EEGNet)和一条示例日志的预先计算结果。离线可用,不发送任何数据。')} {demo ? tr(demoSource) : ''}</div>
      </div>
      <div className="card" data-testid="computer-settings">
        <label className="row"><input type="checkbox" style={{ width: 'auto' }} checked={computer.enabled} onChange={e => void updateComputer({ ...computer, enabled: e.target.checked })} aria-label={tr('连接电脑（增强功能）')} /> {tr('连接电脑（增强功能）')}</label>
        <div className="muted">{tr('默认关闭。关闭时，导入、解析、提问、记录、计划的本地部分和指导都不联系电脑。')}</div>
        {computer.enabled && <>
          <label>{tr('电脑地址')}</label>
          <input value={computer.url} onChange={e => { const next = { ...computer, url: e.target.value }; setComputer(next); void saveComputerSettings(preferencesKV, next); }} inputMode="url" autoCapitalize="off" aria-label={tr('电脑地址')} />
          <button className="ghost" onClick={testComputer}>{tr('测试电脑连接')}</button>
          <div className="muted">{tr('只有下面明确标注“电脑增强”的功能会在开启后使用它。每次最多等 5 秒,失败后自动用手机处理。')}</div>
        </>}
      </div>
      <div className="card" data-testid="model-settings">
        <label>{tr('模型直连(可选;密钥只存在这台手机上,不发给电脑)')}</label>
        <input value={ms.baseUrl} onChange={e => setMs({ ...ms, baseUrl: e.target.value })} inputMode="url" autoCapitalize="off" placeholder="https://…/v1" aria-label={tr('模型地址(Base URL)')} />
        <input value={ms.model} onChange={e => setMs({ ...ms, model: e.target.value })} autoCapitalize="off" placeholder={tr('模型名称')} aria-label={tr('模型名称')} />
        <select aria-label={tr('密钥放在哪个请求头')} value={ms.header} onChange={e => setMs({ ...ms, header: e.target.value as KeyHeader })}>
          <option value="bearer">Authorization: Bearer</option>
          <option value="x-api-key">x-api-key</option>
        </select>
        <input type="password" value={key} onChange={e => setKey(e.target.value)} autoComplete="off" placeholder={keyOnPhone ? tr('本机已有密钥;要换就粘贴新的') : tr('把密钥粘贴到这里,不要发在聊天里')} aria-label={tr('模型密钥')} />
        <div className="muted" data-testid="key-state">{keyOnPhone ? tr('本机已存密钥(不显示)') : tr('本机没有密钥:用规则模式')}</div>
        <button className="primary" onClick={saveModel}>{tr('保存在本机')}</button>
        <button className="ghost" disabled={!keyOnPhone} onClick={testModel}>{tr('测试模型连接')}</button>
        <button className="ghost" disabled={!keyOnPhone} onClick={removeKey}>{tr('删除本机密钥')}</button>
      </div>
      <UpdateCard />
      {status && <div className="card" role="status">{status}</div>}
    </section>
  );
}
