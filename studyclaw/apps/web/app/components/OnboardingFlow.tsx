{step === 2 && (
  <div className="w-full max-w-md">
    <div className="bg-card border border-border rounded-2xl p-6 mb-5">
      <p className="text-sm text-muted-foreground mb-1">Your companion</p>
      <div className="flex items-center gap-3">
        <span className="text-2xl">{AGENTS.find(a => a.key === selectedAgent)?.emoji}</span>
        <span className="font-bold text-lg">{AGENTS.find(a => a.key === selectedAgent)?.name}</span>
        <button onClick={() => setStep(1)} className="ml-auto text-xs text-muted-foreground underline">Change</button>
      </div>
    </div>

    <div className="space-y-5">
      {/* Model selector with search and FREE badge */}
      <div>
        <label className="block text-sm font-medium mb-2">AI Provider &amp; Model</label>
        <div className="relative">
          <input
            type="text"
            value={modelSearch}
            onChange={e => setModelSearch(e.target.value)}
            placeholder="Search models..."
            className="w-full bg-input border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary mb-2"
          />
          <select
            value={modelKey}
            onChange={e => setModelKey(e.target.value)}
            className="w-full bg-input border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          >
            {filteredModels.map(m => (
              <option key={m.key} value={m.key}>
                {m.isFree ? '🟢 FREE - ' : ''}{m.name} ({m.provider})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* API Key */}
      <div>
        <label className="block text-sm font-medium mb-2">
          API Key <span className="text-destructive">*</span>
        </label>
        <input
          type="password"
          value={apiKey}
          onChange={e => { setApiKey(e.target.value); setError(''); }}
          placeholder={selectedModel?.provider === 'openrouter' ? 'sk-or-v1-...' : 'Enter your API key'}
          className="w-full bg-input border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <p className="text-xs text-muted-foreground mt-1">
          Your key is encrypted and never shared. Used only to power your agent.
        </p>
      </div>

      {/* API Key Guide */}
      <div className="bg-muted/30 border border-border rounded-xl p-4 text-xs space-y-2">
        <p className="font-semibold text-sm">📚 How to Get a Free API Key</p>
        <div>
          <p className="font-medium text-primary">OpenRouter (Recommended for Free Tier)</p>
          <ol className="list-decimal list-inside space-y-1 ml-2 text-muted-foreground">
            <li>Visit <a href="https://openrouter.ai/keys" target="_blank" rel="noopener" className="underline text-primary">openrouter.ai/keys</a></li>
            <li>Sign up with Google/GitHub or email</li>
            <li>Copy your API key (starts with <code className="bg-muted px-1 rounded">sk-or-v1-...</code>)</li>
            <li>Select <strong>openrouter/free</strong> or <strong>openrouter/auto</strong> above</li>
          </ol>
          <p className="text-muted-foreground mt-1"><strong>Free tier:</strong> $1 credit on sign-up, rate limits apply (20 requests/min). Auto model picks the best free option.</p>
        </div>
        <div className="border-t border-border pt-2">
          <p className="font-medium">Ollama Cloud (Local models)</p>
          <p className="text-muted-foreground">Run models locally with Ollama — no API key needed if self-hosted. Cloud option coming soon.</p>
        </div>
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}

      <button
        onClick={handleSubmit}
        disabled={isSubmitting || !apiKey.trim() || !modelKey}
        className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-semibold text-lg disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
      >
        {isSubmitting ? 'Activating your agent...' : 'Launch StudyClaw 🚀'}
      </button>
    </div>
  </div>
)}
