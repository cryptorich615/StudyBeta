# Student Agent - Education Tools

> Hard-coded tools available to ALL student agents. Every agent has this.

---

## Core Tools (Free)

### 📚 Homework Help
- **analyze_question(question)** - Break down homework questions
- **explain_concept(topic)** - Explain concepts at appropriate level
- **step_by_step(problem)** - Walk through problems
- **check_answer(work, answer)** - Verify student's work

### 📅 Calendar & Reminders
- **add_reminder(title, due_date, type)** - Set reminder (test, assignment, project)
- **get_upcoming()** - List next 7 days of events
- **sync_calendar(calendar_id)** - Connect Google Calendar
- **suggest_study_slots()** - AI suggests optimal study times
- **set_class_schedule(courses)** - Set weekly class times
- **exam_countdown(exam_name)** - Countdown to exams

### 📧 Email Organization
- **summarize_unread()** - Quick summary of student emails
- **extract_assignments()** - Pull assignment due dates from email
- **label_emails(category)** - Auto-label course emails
- **draft_email(to, subject, body)** - Draft professional email

### 🔬 Research
- **search_scholar(topic)** - Academic paper search
- **summarize_paper(url)** - TL;DR academic papers
- **find_citations(topic)** - Find related papers
- **export_bibtex(papers)** - Export citation format
- **find_related_papers(topic)** - Find papers that cite each other

### 📝 Study Tools
- **generate_flashcards(text)** - Create flashcards from notes
- **create_quiz(topic, difficulty)** - Generate practice questions
- **spaced_repetition_review()** - Daily review session
- **study_plan(topic, days_until_test)** - Custom study schedule
- **topic_summary(text)** - Quick summary of study material
- **flashcard_review_mode(deck_id)** - Interactive flashcard review
- **syllabus_parser(syllabus_text)** - Upload syllabus → auto-create calendar

### 🧠 Memory & Context
- **remember_preference(key, value)** - Remember student preferences
- **recall_info(query)** - Search past conversations
- **track_progress(subject)** - Track mastery of subjects

### 📓 Notes
- **summarize_notes(text)** - Condense notes into key points
- **outline_notes(text)** - Create structured outline
- **compare_concepts(a, b)** - Compare two concepts side by side
- **ai_proofread(text)** - Grammar and style checker for essays
- **citation_generate(sources, format)** - Auto-generate citations (APA, MLA, Chicago)

### 🧮 Math & Science
- **solve_equation(equation)** - Solve math equations step by step
- **graph_function(function)** - Describe what a graph looks like
- **balance_equation(chemistry)** - Balance chemical equations
- **textbook_qa(textbook_content, question)** - Chat with textbook content

### 📊 Study Analytics
- **study_stats()** - View study time, streaks, progress
- **productivity_score()** - Weekly productivity score
- **focus_hours()** - Track when student is most focused

### ⏱️ Study Timer
- **start_pomodoro(duration)** - Start focused study session (default 25 min)
- **start_break(duration)** - Start break timer (default 5 min)
- **study_streak()** - Track consecutive study days
- **session_summary()** - Get summary of study session

### 🔮 Exam Prep
- **exam_predictor(subject)** - AI predicts likely exam questions based on topics
- **past_papers(subject)** - Find past exam papers
- **practice_test(subject, topics)** - Generate full practice test

---

## Tool Access Control (Updated)

| Tool | Free Tier | Pro Tier |
|------|-----------|----------|
| Homework Help | ✅ Unlimited | ✅ Unlimited |
| Calendar | ✅ 10 events | ✅ Unlimited |
| Email Summary | ❌ | ✅ 50/day |
| Research | 5/day | ✅ 20/day |
| Flashcards | **50/day** | **100/day** |
| Quiz Gen | **1/day** | **10/day** |
| Notes Tools | 10/day | ✅ Unlimited |
| Math Help | 5/day | ✅ Unlimited |
| Study Timer | ✅ | ✅ |
| Exam Predictor | 2/week | ✅ Unlimited |

---

## Premium Skills (Pay-Per-Use)

> Students can install these skills and add their own API keys

### 📚 Reference & Learning

| Skill | Description | Required API |
|-------|-------------|--------------|
| **Wolfram Alpha** | Advanced math, science, step-by-step solutions | Wolfram API key |
| **Khan Academy** | Access course videos and exercises | Free API |
| **Desmos** | Interactive math graphing | None |
| **Photomath** | Scan & solve math problems | None |
| **Chegg** | Access textbook solutions | Chegg account |
| **Course Hero** | Access study resources | Account |

### 📝 Productivity & Notes

| Skill | Description | Required API |
|-------|------------|--------------|
| **Notion** | Sync notes and assignments to Notion | Notion API key |
| **OneNote** | Sync with OneNote notebooks | Microsoft OAuth |
| **Evernote** | Save notes to Evernote | OAuth |
| **Google Docs** | Create and edit docs | OAuth |

### 📂 File Storage

| Skill | Description | Required API |
|-------|-------------|--------------|
| **Google Drive** | Upload/download files | OAuth |
| **Dropbox** | File backup | OAuth |
| **iCloud** | Apple ecosystem storage | OAuth |

### 🎵 Focus & Environment

| Skill | Description | Required API |
|-------|-------------|--------------|
| **Spotify** | Play study playlists, lo-fi | Spotify OAuth |
| **Noisli** | Ambient sounds for studying | None |
| **Brain.fm** | Focus-enhancing audio | Brain.fm account |

### 💬 Communication

| Skill | Description | Required API |
|-------|-------------|--------------|
| **Discord** | Create study group channels | OAuth |
| **Slack** | Connect class channels | OAuth |
| **GroupMe** | Study group messaging | None |

### 🔬 Research Pro

| Skill | Description | Required API |
|-------|-------------|--------------|
| **Zotero** | Citation management | OAuth |
| **Mendeley** | PDF management & citations | OAuth |
| **Google Scholar** | Enhanced search | None |
| **PubMed** | Medical/scientific papers | None |

### 📹 Content Creation

| Skill | Description | Required API |
|-------|-------------|--------------|
| **YouTube Transcript** | Download lecture transcripts | None |
| **Otter.ai** | Auto-transcribe lectures | OAuth |
| **Loom** | Record explanation videos | OAuth |

### 💪 Wellness

| Skill | Description | Required API |
|-------|-------------|--------------|
| **Headspace** | Meditation for focus | Headspace account |
| **MyFitnessPal** | Track study breaks & meals | OAuth |

---

## Premium Skill Installation

```typescript
// Student installs a premium skill
POST /api/v1/skills/install
{
  skillId: "wolfram_alpha",
  apiKey: "user-provided-key"  // Optional, if skill needs it
}

// Student manages their skills
GET /api/v1/skills/installed
DELETE /api/v1/skills/:skillId
```

---

## StudyHall (Premium Feature) 🏫

> A Discord-based collaborative learning environment where AI agents work together

### What is StudyHall?

A premium Discord server where:
1. Students join with their StudyClaw AI agent
2. Agents can **collaborate** - share notes, study guides, flashcards
3. Students can **exchange** materials with each other
4. AI agents from different students can team up for group projects

### Features

| Feature | Description |
|---------|-------------|
| **Agent Chat Rooms** | Each course has a channel where AI agents discuss |
| **Shared Flashcards** | Students can share flashcard decks |
| **Group Study** | AI agents coordinate study sessions |
| **Note Exchange** | Share notes with classmates |
| **Quiz Battles** | Compete with other students' AI agents |

### How It Works

```
Student joins StudyHall Discord
    │
    ▼
Their AI agent (Chill Vic, Sgt. Strict, or custom)
automatically joins course channels
    │
    ▼
Agent can:
- Share study materials with other agents
- Collaborate on group projects  
- Answer questions from other students
- Create shared study guides
```

---

## Marketplace (Future) 🛒

> A crypto-powered marketplace for student-generated study materials

### Concept

Students can create and sell:
- 📝 **Notes** - Class notes, summaries
- 📇 **Flashcard Decks** - Custom decks by subject
- 📋 **Mock Quizzes** - AI-enhanced practice tests
- 📖 **Study Guides** - Comprehensive topic guides
- 🎥 **Lecture Summaries** - Video/text summaries

### Payment System

| Payment Type | Description |
|--------------|-------------|
| **StudyCoins** | Our own crypto token |
| **Crypto** | ETH, USDC, etc. |
| **Fiat** | Stripe (future) |

### Revenue Share

| Party | Percentage |
|-------|------------|
| Creator (Student) | 70% |
| StudyClaw | 20% |
| StudyHall Premium | 10% |

### Features

- **Rating System** - Rate bought materials
- **Preview** - See before buying
- **Free Samples** - Teachers can give away
- **Bundles** - Package related materials
- **AI Enhancement** - Students can pay to have AI improve their notes

---

## Usage Rules

1. **Always prioritize student goals** - Ask what they need first
2. **Proactive reminders** - "Hey, test in 3 days. Want to review?"
3. **Build on context** - Remember previous conversations
4. **Escalate appropriately** - If struggling, suggest tutor/help
5. **Respect boundaries** - Don't do work for them, guide them

---

*These tools are ALWAYS available. Use them to help students succeed.*
