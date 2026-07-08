# Community Intelligence MVP Specification

## 1. Product Summary

Community Intelligence is an analysis engine for Telegram groups and channels.

The system imports Telegram conversations, filters noise, extracts structured signals, and turns message streams into actionable intelligence:

- Main topics
- Pain points
- User requests
- Offers
- Trends
- Participant profiles
- Business opportunities

The MVP should focus on building the core analysis engine first. A SaaS product, billing, teams, and advanced workspace management can be built later on top of this engine.

## 2. Goals

The MVP should answer questions such as:

- What topics are discussed most often?
- What problems repeat across the community?
- What are people asking for?
- What services or products are being offered?
- Which technologies, companies, and products are mentioned?
- Which participants are useful or commercially relevant?
- Which questions remain unanswered?
- Where are new business opportunities emerging?

## 3. Non-Goals For MVP

The MVP should not initially include:

- Full SaaS billing
- Multi-tenant organization management
- Public self-service onboarding
- Advanced access control
- Complex CRM workflows
- Real-time streaming analytics
- A fully general knowledge graph UI

## 4. High-Level Architecture

```text
                Telegram (MTProto)
                        |
                        v
             Message Import Worker
                        |
                        v
                 PostgreSQL
                        |
                        v
              Queue (BullMQ/Redis)
                        |
                        v
               AI Analysis Workers
                        |
                        v
              Knowledge Database
                        |
                        v
                   REST API
                        |
                        v
                    Web UI
```

## 5. Technology Stack

### Backend

- Node.js
- TypeScript
- Express
- BullMQ
- Redis
- PostgreSQL
- Prisma

### Telegram Integration

- MTProto
- GramJS for Node.js
- Telethon may be considered only if the import worker is moved to Python

The Bot API must not be used for message history import.

### AI

- OpenRouter
- OpenAI-compatible API
- JSON-structured model outputs

## 6. MVP Implementation Strategy

The MVP should use a two-stage analysis pipeline:

1. A cheap pre-classification stage filters out noise and identifies messages worth deeper analysis.
2. LLM analysis runs only on meaningful messages and extracts structured signals.

This is preferred over sending every message directly to an LLM, because Telegram communities contain a large amount of low-value content such as short replies, emojis, thank-you messages, bumps, and chatter.

## 7. Telegram Import

### 7.1 Connection

Users connect a Telegram account using MTProto.

The implementation must support:

- Phone number login
- Telegram login code
- Optional 2FA password
- Persisted session data

### 7.2 Imported Sources

The system should import:

- Groups
- Channels
- Message history

### 7.3 Import Behavior

The import worker should be intentionally slow and rate-limit friendly.

Example:

```text
Import 100 messages
Sleep for 3 seconds
Import next 100 messages
Sleep for 3 seconds
```

Each chat must have an import checkpoint so the worker can resume safely.

The checkpoint should use:

```text
lastMessageId
```

## 8. Core Data Model

### 8.1 Chat

```text
id
telegramId
title
username
type
lastMessageId
createdAt
```

### 8.2 User

```text
id
telegramId
username
firstName
lastName
photo
isBot
```

### 8.3 Message

```text
id
telegramId
chatId
userId
text
date
replyTo
views
forwards
rawJson
```

### 8.4 Message Analysis

Each meaningful message should receive a structured analysis record.

Example output:

```json
{
  "language": "ru",
  "intent": "looking_for_service",
  "category": "development",
  "topics": ["AI", "Telegram", "CRM"],
  "entities": ["Berlin", "OpenAI"],
  "sentiment": "neutral",
  "pain": "Missing CRM capabilities",
  "offer": null,
  "request": "Looking for a developer",
  "commercialScore": 8,
  "confidence": 0.91
}
```

Recommended additional storage fields:

```text
id
messageId
language
intent
category
topics
entities
sentiment
pain
offer
request
commercialScore
confidence
isNoise
model
rawJson
createdAt
```

## 9. Analysis Pipeline

### 9.1 Pre-Classifier

The pre-classifier decides whether a message is worth deeper processing.

It should filter out:

- Very short acknowledgements
- Emoji-only messages
- "thanks" messages
- Bumps
- Non-informational replies
- Low-context chatter

It should keep messages that contain:

- Requests
- Pain points
- Offers
- Product mentions
- Technology mentions
- Company mentions
- Questions
- Recommendations
- Strong commercial intent

The first implementation may use simple rules. A smaller model can be added later if needed.

### 9.2 LLM Signal Extraction

For messages that pass the pre-classifier, the LLM should extract:

- Language
- Intent
- Category
- Topics
- Entities
- Sentiment
- Pain point
- Offer
- Request
- Commercial score
- Confidence

The LLM must return strict JSON.

### 9.3 Aggregation

Aggregations should be computed from extracted signals, not by repeatedly asking the LLM to read all raw messages.

Aggregations should support:

- Group overview
- Topic rankings
- Pain point rankings
- Request rankings
- Offer rankings
- Technology mentions
- Company mentions
- Trend windows
- User profiles
- Unanswered requests
- Business opportunities

## 10. Knowledge Layer

The system should build structured entities from analyzed messages.

Entity types:

- Topics
- Companies
- Products
- People
- Locations
- Technologies
- Pain points
- Requests
- Offers

Each entity should track:

```text
count
trend
relatedEntities
```

For the MVP, this can be implemented as relational tables and materialized aggregations. A graph database is not required initially.

## 11. User Profiles

The system should build a profile for each participant.

Example:

```json
{
  "summary": "",
  "topics": [],
  "interests": [],
  "needs": [],
  "offers": [],
  "companies": [],
  "locations": [],
  "expertise": [],
  "activityScore": 0,
  "commercialScore": 0
}
```

Profiles must be built from aggregated signals, not by repeatedly sending a user's full message history to an LLM.

## 12. Group Report

The main UI screen should be a group report.

### 12.1 Overview

Show:

- Message count
- Participant count
- Imported date period
- Number of new participants

### 12.2 Main Topics

Example topics:

- AI
- Node.js
- Business
- Marketing
- Taxes

### 12.3 Main Pain Points

Example pain points:

- Finding clients
- Hiring employees
- Automation
- Taxes
- Relocation

### 12.4 Main Requests

Example requests:

- Looking for a job
- Looking for a contractor
- Looking for advice
- Looking for an investor
- Looking for a CRM

### 12.5 Offers

Example offers:

- Development
- Legal services
- Marketing
- AI consulting
- Design

### 12.6 Popular Technologies

Example technologies:

- Cursor
- Claude
- GPT
- MCP
- n8n

### 12.7 Popular Companies

Example companies:

- OpenAI
- Google
- Amazon
- SAP

### 12.8 Trends

Show topic movement over:

- 7 days
- 30 days
- 90 days

Each trend should show growth or decline.

### 12.9 Most Useful Participants

Participants should not be ranked only by message count.

Usefulness can be based on:

- Replies given
- Reactions received, where available
- Mentions
- Participation in longer discussions
- Meaningful messages
- High-confidence offers or expertise signals

### 12.10 Unanswered Questions

This is a key product section.

Example insight:

```text
In the last 30 days, 37 people looked for an accountant and did not receive a useful answer.
```

Another example:

```text
In the last 30 days, 28 people asked for AI automation help and no clear solution was found.
```

For MVP purposes, a request can be considered unanswered if no relevant reply, offer, recommendation, or solution signal appears in the nearby reply chain or following message window.

### 12.11 Business Opportunities

The AI should generate a top opportunities list from aggregated signals.

Example:

```text
High demand for AI automation among small businesses.
This suggests a strong probability of commercial demand.
```

The Business Opportunities section is the product's main differentiator. The system should not merely report Telegram activity metrics; it should identify demand, repeated problems, unsolved needs, and emerging niches.

## 13. REST API

Initial endpoints:

```text
GET /groups
GET /groups/:id
GET /groups/:id/topics
GET /groups/:id/pains
GET /groups/:id/requests
GET /groups/:id/trends
GET /groups/:id/opportunities
GET /groups/:id/users
GET /groups/:id/messages
```

Recommended additional endpoints:

```text
POST /telegram/connect/start
POST /telegram/connect/verify-code
POST /telegram/connect/verify-password
POST /imports/:chatId/start
GET /imports/:chatId/status
POST /analysis/:chatId/start
GET /analysis/:chatId/status
```

## 14. Web UI

The MVP UI should be simple and operational.

Required views:

- Groups list
- Group overview
- Topics
- Pain points
- Requests
- Offers
- Trends
- Opportunities
- Users
- Messages

The UI does not need to be a full SaaS dashboard in the first version.

## 15. MVP Milestones

### Milestone 1: Project Foundation

- Node.js and TypeScript setup
- Express API
- PostgreSQL and Prisma setup
- Redis and BullMQ setup
- Basic health endpoint

### Milestone 2: Telegram Import

- MTProto login flow
- Persisted Telegram session
- Chat listing
- Message history import
- Slow batched import
- Checkpoint support

### Milestone 3: Analysis Pipeline

- Pre-classifier
- Analysis queue
- LLM JSON extraction
- Message analysis persistence
- Retry and error handling

### Milestone 4: Aggregations

- Topics
- Pain points
- Requests
- Offers
- Technologies
- Companies
- Trends

### Milestone 5: Reports API

- Group report endpoints
- User profile endpoint
- Opportunities endpoint
- Unanswered questions endpoint

### Milestone 6: Minimal Web UI

- Groups screen
- Group report screen
- Basic charts or ranked lists
- Opportunities section

## 16. Open Questions

These decisions should be confirmed before or during implementation:

- Should the first version support one Telegram account or multiple accounts?
- Should Telegram session data be encrypted at rest?
- What is the expected import size for the MVP: thousands, hundreds of thousands, or millions of messages?
- Which OpenRouter/OpenAI-compatible model should be used first?
- Should analysis run automatically after import or be manually triggered?
- What languages should be supported in the first version?
- Should private groups be supported, or only groups/channels the connected account can already access?
- Should deleted or edited Telegram messages be tracked?
- How strict should the unanswered-question detection be?

## 17. Success Criteria

The MVP is successful when it can:

- Connect a Telegram account through MTProto
- Import group or channel history safely with checkpoints
- Store chats, users, and messages in PostgreSQL
- Filter low-value messages before LLM processing
- Extract structured signals from meaningful messages
- Aggregate those signals into group-level intelligence
- Expose the data through REST endpoints
- Show a basic group report UI
- Generate useful business opportunities from community activity
