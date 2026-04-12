'use client';

import { useMemo, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { SettingsDetailShell, SettingsStatus, useSettingsSnapshot } from './settings-core';

export function AgentSettingsDetail() {
  const { snapshot, status, setSnapshot, setStatus } = useSettingsSnapshot();
  const [skillQuery, setSkillQuery] = useState('');
  const [updatingSkill, setUpdatingSkill] = useState('');
  const studySkillBundles: Array<{
    name: string;
    title: string;
    summary: string;
  }> = [
    {
      name: 'study-library',
      title: 'Student library',
      summary: 'Book discovery, textbook lookup, and reading-oriented research using Open Library first.',
    },
    {
      name: 'grade-tracker',
      title: 'Grade tracker',
      summary: 'Estimated grades, target-score math, and wrong-answer review grounded in saved class data.',
    },
    {
      name: 'class-scheduler',
      title: 'Class scheduler',
      summary: 'Current class, next class, room, teacher, and schedule-aware tutoring context.',
    },
    {
      name: 'study-habits',
      title: 'Study habits',
      summary: 'Routine, focus, and consistency coaching tied to the student’s real workload and calendar.',
    },
    {
      name: 'study-buddy-ai',
      title: 'Study buddy AI',
      summary: 'General-purpose study companion behavior that turns conversation into useful study actions.',
    },
    {
      name: 'study-tutor',
      title: 'Study tutor',
      summary: 'Step-by-step explanations, examples, misconceptions, and guided practice.',
    },
    {
      name: 'course-study',
      title: 'Course study',
      summary: 'Course-specific study planning using grades, assignments, schedule, and weak-topic context.',
    },
    {
      name: 'study-buddy',
      title: 'Study buddy',
      summary: 'Short, practical accountability support to keep students moving through work.',
    },
    {
      name: 'study-revision-planner',
      title: 'Revision planner',
      summary: 'Exam and revision plans built from real deadlines, weak topics, and available time.',
    },
    {
      name: 'learn-cog',
      title: 'Learn cog',
      summary: 'Multi-angle teaching with analogies, examples, and layered explanations.',
    },
    {
      name: 'exam',
      title: 'Exam prep',
      summary: 'Exam-focused prioritization, last-minute review plans, and risk-aware prep advice.',
    },
    {
      name: 'learning-optimizer',
      title: 'Learning optimizer',
      summary: 'Uses saved student data to improve study order, time use, and review strategy.',
    },
  ];

  async function toggleSkill(skillName: string, enabled: boolean) {
    setUpdatingSkill(skillName);
    const response = await apiFetch(`/api/openclaw/skills/${encodeURIComponent(skillName)}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    });
    const data = await response.json();

    if (!response.ok) {
      setStatus(data.message || 'Failed to update skill');
      setUpdatingSkill('');
      return;
    }

    setSnapshot(data);
    setStatus('');
    setUpdatingSkill('');
  }

  const filteredSkills = useMemo(() => {
    return (snapshot?.skills.items ?? []).filter((skill) => {
      const query = skillQuery.trim().toLowerCase();
      if (!query) {
        return true;
      }

      return (
        skill.name.toLowerCase().includes(query) ||
        skill.description.toLowerCase().includes(query) ||
        skill.status.toLowerCase().includes(query)
      );
    });
  }, [skillQuery, snapshot?.skills.items]);

  return (
    <SettingsDetailShell
      badge="Agent Settings"
      title="Manage OpenClaw-specific agent controls."
      description="This page holds skill readiness and agent-level controls while the top-level Settings screen stays navigation-first."
    >
      <SettingsStatus status={status} probe={snapshot?.diagnostics.channelsProbe} />

      <div className="card-grid">
        <section className="secondary-card">
          <p className="eyebrow">System details</p>
          <div className="settings-stack" style={{ marginTop: 14 }}>
            <div className="settings-row">
              <div>
                <strong>Skill coverage</strong>
                <p className="muted-copy" style={{ margin: '4px 0 0' }}>
                  Ready: {snapshot?.skills.readyCount ?? 0} / {snapshot?.skills.totalCount ?? 0}
                </p>
              </div>
              <span className="settings-badge">{filteredSkills.length} visible</span>
            </div>
            <div className="settings-row">
              <div>
                <strong>Sessions health</strong>
                <p className="muted-copy" style={{ margin: '4px 0 0' }}>
                  {snapshot?.diagnostics.sessionsOk ? 'Session files look healthy.' : 'Session diagnostics need attention.'}
                </p>
              </div>
              <span className={`settings-badge ${snapshot?.diagnostics.sessionsOk ? 'is-live' : ''}`}>
                {snapshot?.diagnostics.sessionsOk ? 'OK' : 'Check'}
              </span>
            </div>
          </div>
        </section>

        <section className="secondary-card">
          <p className="eyebrow">Search skills</p>
          <div className="form-field" style={{ marginTop: 12 }}>
            <label htmlFor="skill-query">Filter by name, description, or status</label>
            <input
              id="skill-query"
              value={skillQuery}
              onChange={(event) => setSkillQuery(event.target.value)}
              placeholder="Search skills"
            />
          </div>
        </section>
      </div>

      <section className="secondary-card">
        <p className="eyebrow">StudyClaw skill bundles</p>
        <div className="settings-stack" style={{ marginTop: 14 }}>
          {studySkillBundles.map((bundle) => {
            const matchingSkill = snapshot?.skills.items.find((skill) => skill.name === bundle.name);
            return (
              <div className="settings-row" key={bundle.name}>
                <div>
                  <strong>{bundle.title}</strong>
                  <p className="muted-copy" style={{ margin: '4px 0 0' }}>
                    {bundle.summary}
                  </p>
                </div>
                <span className={`settings-badge ${matchingSkill?.enabled ? 'is-live' : ''}`}>
                  {matchingSkill?.enabled ? 'Inherited' : 'Disabled'}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="secondary-card">
        <p className="eyebrow">Skills</p>
        <div className="settings-stack" style={{ marginTop: 14 }}>
          {filteredSkills.length ? (
            filteredSkills.map((skill) => (
              <div className="settings-row" key={skill.name}>
                <div>
                  <strong>{skill.displayName || skill.name}</strong>
                  <p className="muted-copy" style={{ margin: '4px 0 0' }}>
                    {skill.description}
                    {' · '}
                    {skill.status}
                    {' · '}
                    {skill.source}
                  </p>
                </div>
                <button
                  type="button"
                  className={`toggle-chip ${skill.enabled ? 'is-on' : ''}`}
                  onClick={() => void toggleSkill(skill.name, !skill.enabled)}
                  disabled={updatingSkill === skill.name}
                >
                  {updatingSkill === skill.name ? 'Updating...' : skill.enabled ? 'Enabled' : 'Disabled'}
                </button>
              </div>
            ))
          ) : (
            <p className="muted-copy">No skills match your current filter.</p>
          )}
        </div>
      </section>
    </SettingsDetailShell>
  );
}
