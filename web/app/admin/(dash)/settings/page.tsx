'use client';

// 系统设置:LLM 服务配置(后台配置优先于环境变量;Key 只掩码回显) + 连通性测试

import { PlugZap, Save, Settings } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '@/lib/admin-client';
import { Badge, Button, Field, Input, Notice, Spinner } from '@/components/admin/ui';

interface LlmSettings {
  baseUrl: string | null;
  apiKeyConfigured: boolean;
  apiKeyPreview: string | null;
  model: string | null;
}

export default function AdminSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [form, setForm] = useState({ baseUrl: '', apiKey: '', model: '' });
  const [configured, setConfigured] = useState<LlmSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<null | { ok: boolean; text: string }>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await api<{ llm: LlmSettings }>('/api/admin/settings/llm');
      setConfigured(res.llm);
      setForm({ baseUrl: res.llm.baseUrl ?? '', apiKey: '', model: res.llm.model ?? '' });
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setNotice(null);
    setError(null);
    try {
      const res = await api<{ llm: LlmSettings }>('/api/admin/settings/llm', {
        method: 'PUT',
        // apiKey 留空 = 不变;要清除请输入空格后保存?——约定:留空即不变,清空需传 null
        body: JSON.stringify({
          baseUrl: form.baseUrl === '' ? null : form.baseUrl,
          apiKey: form.apiKey === '' ? undefined : form.apiKey,
          model: form.model === '' ? null : form.model,
        }),
      });
      setConfigured(res.llm);
      setForm({ baseUrl: res.llm.baseUrl ?? '', apiKey: '', model: res.llm.model ?? '' });
      setNotice('LLM 配置已保存(优先于环境变量)');
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function testConnection(): Promise<void> {
    if (testing) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api<{ ok: boolean; model?: string; sample?: string; code?: string; message?: string }>('/api/admin/settings/llm/test', { method: 'POST' });
      if (res.ok) {
        setTestResult({ ok: true, text: `连通成功 · 模型 ${res.model} · 回复「${res.sample}」` });
      } else {
        setTestResult({ ok: false, text: `${res.code}:${res.message}` });
      }
    } catch (err) {
      setTestResult({ ok: false, text: err instanceof Error ? err.message : '测试失败' });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {notice ? <Notice tone="success">{notice}</Notice> : null}

      <div className="mb-5 rounded-xl bg-white p-5 shadow-sm transition-shadow duration-200 hover:shadow-md">
        <div className="flex items-center gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-white" style={{ background: 'linear-gradient(135deg,#64748b,#334155)' }}>
            <Settings size={24} aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-semibold text-[#0f172a]">系统设置</h1>
            <p className="mt-1 text-sm text-[#64748b]">运行时配置;此处配置优先于环境变量(AI_BASE_URL / AI_API_KEY / AI_MODEL)</p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex min-h-[200px] items-center justify-center gap-2 rounded-xl bg-white text-sm text-[#64748b] shadow-sm">
          <Spinner size={18} /> 加载中…
        </div>
      ) : (
        <form onSubmit={(e) => void save(e)} className="rounded-xl bg-white p-5 shadow-sm" noValidate>
          <h2 className="mb-1 text-base font-semibold text-[#0f172a]">LLM 服务配置</h2>
          <p className="mb-4 text-xs leading-relaxed text-[#94a3b8]">
            OpenAI 兼容接口(chat/completions 与 models 端点)。模型留空时自动从 /models 发现并取第一个对话模型。
          </p>
          <div className="grid max-w-3xl grid-cols-1 gap-4">
            <Field label="Base URL*">
              <Input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} placeholder="https://api.deepseek.com" />
            </Field>
            <Field
              label={configured?.apiKeyConfigured ? `API Key(已配置 ${configured.apiKeyPreview};留空保持不变)` : 'API Key*'}
            >
              <Input
                type="password"
                autoComplete="new-password"
                value={form.apiKey}
                onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                placeholder={configured?.apiKeyConfigured ? '••••••••' : 'sk-…'}
              />
            </Field>
            <Field label="模型(可选,留空自动发现)">
              <Input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="deepseek-chat" />
            </Field>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button variant="primary" type="submit" disabled={saving || !form.baseUrl}>
              <Save size={14} /> {saving ? '保存中…' : '保存配置'}
            </Button>
            <Button variant="secondary" type="button" disabled={testing} onClick={() => void testConnection()}>
              <PlugZap size={14} /> {testing ? '测试中…' : '测试连通'}
            </Button>
            {configured?.baseUrl && !form.baseUrl ? (
              <Badge tone="info">当前使用后台配置</Badge>
            ) : !configured?.baseUrl ? (
              <Badge tone="warning">后台未配置时回退环境变量</Badge>
            ) : null}
          </div>
          {testResult ? (
            testResult.ok ? (
              <Notice tone="success">{testResult.text}</Notice>
            ) : (
              <Notice tone="error">{testResult.text}</Notice>
            )
          ) : null}
        </form>
      )}
    </div>
  );
}
