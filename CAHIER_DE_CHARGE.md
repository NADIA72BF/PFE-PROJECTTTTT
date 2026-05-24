# Software Requirements Specification (SRS)
## GI Immobilier — Real Estate Management Platform

**Project:** GI Immobilier  
**Platform type:** Web application — real estate listing, reservation, and transaction management  
**Backend:** Node.js / Express (Zoho-First Architecture)  
**Data layer:** Zoho Creator (low-code database + Deluge workflow engine)  
**AI assistant:** Groq API (LLaMA 3.1 8B Instant) — chatbot "Nexia"  
**Region / currency:** Tunisia, Tunisian Dinar (DT)  
**Language:** French (UI), English (code)

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture Overview](#2-architecture-overview)
3. [User Roles and Access Control](#3-user-roles-and-access-control)
4. [Authentication & Account Management](#4-authentication--account-management)
5. [Property Management](#5-property-management)
6. [Reservation Flow (Rental)](#6-reservation-flow-rental)
7. [Purchase Flow (Sale)](#7-purchase-flow-sale)
8. [Advance Payment Flow](#8-advance-payment-flow)
9. [Contract Management](#9-contract-management)
10. [Payment Tracking](#10-payment-tracking)
11. [Owner Dashboard](#11-owner-dashboard)
12. [Agent Dashboard](#12-agent-dashboard)
13. [Admin Dashboard](#13-admin-dashboard)
14. [AI Chatbot — Nexia](#14-ai-chatbot--nexia)
15. [Image Management](#15-image-management)
16. [API Endpoint Reference](#16-api-endpoint-reference)
17. [Zoho Creator Workflow Reference](#17-zoho-creator-workflow-reference)
18. [Frontend Pages Reference](#18-frontend-pages-reference)
19. [Non-Functional Requirements](#19-non-functional-requirements)
20. [Technical Stack](#20-technical-stack)
21. [Environment Configuration](#21-environment-configuration)

---

## 1. Project Overview

GI Immobilier is a Tunisian real estate web platform allowing:

- **Property owners** to list properties for rent or sale.
- **Tenants/buyers** (referred to as "Users") to browse listings, submit reservation or purchase requests, and pay an advance online.
- **Real estate agents** to validate listings, monitor reservations, and manage contracts.
- **Administrators** to oversee all users, properties, and platform operations.

The platform follows a **Zoho-First** architecture: Node.js acts as a thin proxy layer (authentication, session, image handling, OAuth). All business logic (status transitions, calculations, contract generation, notifications) lives in **Zoho Creator Deluge workflows**.

---

## 2. Architecture Overview

### 2.1 Layers

```
┌──────────────────────────────────────────────────────┐
│                   Browser (HTML/CSS/JS)               │
│  Public site · User dashboard · Owner / Agent / Admin │
└──────────────────────┬───────────────────────────────┘
                       │ HTTP (REST JSON)
┌──────────────────────▼───────────────────────────────┐
│              Node.js / Express (api-proxy.js)         │
│  - Session management (express-session)               │
│  - OAuth token refresh (Zoho oauthtoken / Bearer)     │
│  - Image proxy & local upload cache                   │
│  - Rate limiting (login × 10, forgot-pw × 5)         │
│  - Compression, Helmet security headers               │
│  - Groq AI chatbot endpoint (/chat)                   │
└──────────────────────┬───────────────────────────────┘
                       │ HTTPS (Zoho Creator REST API v2 / v2.1)
┌──────────────────────▼───────────────────────────────┐
│                  Zoho Creator                         │
│  Forms: User · Property · Reservation · Purchase      │
│         Contract · Payment                            │
│  Reports: All_Users · All_Properties · All_Reservations│
│           All_Purchases · All_Contracts · All_Payments │
│  Deluge Workflows (see §17)                           │
└──────────────────────────────────────────────────────┘
                       │
┌──────────────────────▼──────┐  ┌────────────────────┐
│       Zoho CRM              │  │   Zoho Books        │
│  (synced on user creation)  │  │  (invoice tracking) │
└─────────────────────────────┘  └────────────────────┘
```

### 2.2 Zoho API Endpoints (multi-base fallback)

Node.js tries three base URLs in order for every Zoho call, falling back silently on error:

| Priority | Base URL | Auth Header |
|----------|----------|-------------|
| 1 (preferred) | `https://www.zohoapis.com/creator/v2.1/data/2demonexflow/gestion-immobili-re` | `Zoho-oauthtoken <token>` |
| 2 | `https://creator.zoho.com/api/v2/2demonexflow/gestion-immobili-re` | `Bearer <token>` |
| 3 (fallback) | `https://creatorapp.zoho.com/api/v2/2demonexflow/gestion-immobili-re` | `Bearer <token>` |

### 2.3 In-memory Caching (Node.js)

| Cache | TTL | Key |
|-------|-----|-----|
| Properties list response | 15 s (configurable) | query params JSON |
| Single property detail | 15 s (configurable) | record ID |
| User by email / by ID | 30 s | email or ID string |
| Generic report | 30 s | report name |
| Owner property ID set | 2 min | `owner:<userId>:<userId1>` |
| Image field map | 1 h (configurable) | field name |

---

## 3. User Roles and Access Control

| Role | Description | Dashboard |
|------|-------------|-----------|
| `User` | Registered tenant / buyer | `user_dashboard.html` |
| `Agent` | Real estate agent employed by the agency | `agent_dashboard.html` |
| `Administrator` / `Admin` | Platform manager with full access | `admin_dashboard.html` |
| *(unauthenticated)* | Public visitor — browse only | `index.html`, `annonces.html`, `detail.html` |

Role is stored in Zoho Creator (`Role` field on the `User` form), returned in the session on login, and used in:
- `auth-helper.js` — client-side nav rendering and post-login redirect
- `/chat` endpoint — Groq system prompt and action gating
- Frontend pages — conditional UI rendering

---

## 4. Authentication & Account Management

### 4.1 Registration (Two-Step Email Verification)

**Flow:**

1. User submits registration form (`inscription.html`) → `POST /api/signup`
2. Node.js validates: all fields present, passwords match, valid email format, email not already in Zoho, email not already pending.
3. A 32-byte hex token is generated and stored in the in-memory `pendingSignups` Map (TTL: 24 hours). The map holds: `{ email, first_name, last_name, phone_number, password, role: 'User', createdAt }`.
4. A verification email is sent via **Zoho Creator Custom API** (`send_email_direct`) containing a link to `verify-email.html?token=TOKEN&email=EMAIL`.
5. User clicks the link → `GET /api/auth/verify-email?token=TOKEN&email=EMAIL`
6. Node.js: validates token matches email, checks not expired, checks email not already registered (race-condition guard), then **creates the Zoho Creator record** via `POST /form/User`.
7. The Zoho `Add_User` workflow runs server-side (password strength, uniqueness, default role, CRM sync).
8. On success: token deleted from `pendingSignups`, user redirected to `login.html`.

**Resend verification:** `POST /api/auth/resend-verification` — rotates token, re-sends email.

**Fields collected:**
- `first_name`, `last_name` (stored as `full_name` object in Zoho)
- `email` (lowercased, trimmed)
- `phone_number`
- `password` (stored in plain text in Zoho — hashing delegated to Zoho workflow if implemented)

### 4.2 Login

**Endpoint:** `POST /api/login` (rate-limited: 10 requests / 15 min per IP)

**Flow:**
1. Look up user by email in `All_Users` report.
2. Fetch full user record by ID to access the `Password` field.
3. Compare `Password` field directly (plain text comparison).
4. On success: create session with `userId`, `userId1`, `userEmail`, `userName`, `userRole`.

**Session data stored:**

```javascript
req.session.userId     // Zoho record system ID
req.session.userId1    // Zoho ID1 (user-defined, used for lookups)
req.session.userEmail  // normalized lowercase email
req.session.userName   // "first_name last_name"
req.session.userRole   // e.g. "User", "Agent", "Administrator"
```

**Session cookie:** 24-hour max-age, non-secure (intended for dev; set `secure: true` in production behind HTTPS).

### 4.3 Logout

- `POST /api/logout` — destroys session, clears owner property cache, returns JSON.
- `GET /api/logout` — destroys session, redirects to `index.html`.

### 4.4 Auth Status Check

`GET /api/auth-status` — returns `{ loggedIn: true, user: { id, id1, email, name, role } }` or `{ loggedIn: false }`. Used by every page via `auth-helper.js` on `DOMContentLoaded`.

### 4.5 Password Reset

**Flow:**
1. `POST /api/auth/forgot-password` (rate-limited: 5 / 15 min) — looks up user by email, generates a 32-byte token with 30-minute expiry, PATCHes `Reset_Token` and `Reset_Token_Expiry` fields in Zoho. Note: the email-sending step is currently logged but **not sent** (no SMTP call in forgot-password endpoint; relies on Zoho workflow or manual follow-up).
2. `POST /api/auth/verify-reset-token` — validates token and expiry.
3. `POST /api/auth/reset-password` — re-validates token/expiry, PATCHes `Password`, clears reset fields.

**UI pages:** `reset.html`

### 4.6 Profile Update

**Endpoint:** `POST /api/agent/profile/update` (authenticated)

Allows any logged-in user to update their own: `first_name`, `last_name`, `email`, `phone_number`, and optionally `password`. Role cannot be changed via this endpoint (security guard). Uses `updateUserDirect()` — tries 3 base URLs × 2 criteria patterns.

**UI pages:** `profile.html`, `agent_profile.html`

---

## 5. Property Management

### 5.1 Property Listing Types

| Field `type_field` value | Meaning |
|--------------------------|---------|
| `For Sale` | Property available for purchase |
| `To Rent` | Property available for short or long-term rental |

The frontend normalizes "Location" (French) → `To Rent` when submitted.

### 5.2 Validation Status

Properties require agent/admin approval before appearing publicly:

| `Validation_Status` | Meaning |
|---------------------|---------|
| `pending` | Awaiting review |
| `approved` | Visible to public |
| `rejected` | Hidden, deleted from Zoho |

These values are configured via `.env` (`PROPERTY_PENDING_VALUE`, `PROPERTY_APPROVED_VALUE`, `PROPERTY_REJECTED_VALUE`).

### 5.3 Public Property Listing

**Endpoint:** `GET /api/properties[?limit=N]`

- Fetches all properties from Zoho (multi-base fallback, up to 200 records).
- Filters to only `approved` records.
- Enriches each record with `image_url` and `image_proxy_url`.
- Cached for 15 seconds.
- Response: `{ code: 3000, source: 'zoho-v21', data: [...] }`

**UI pages:** `annonces.html`, `index.html` (featured listings)

### 5.4 Property Detail

**Endpoint:** `GET /api/properties/:id`

Returns the full single-record payload enriched with image. Used by `detail.html` to display all property metadata.

### 5.5 Owner Contact

**Endpoint:** `GET /api/properties/:id/contact` (authenticated)

Returns owner's phone number, display name, and a pre-formatted WhatsApp link (Tunisian number format: prefix `216`).

### 5.6 Owner's Own Properties

**Endpoint:** `GET /api/properties/user` (authenticated)

Returns all properties where the logged-in user is the `User` (owner) field. Uses criteria-first approach, falls back to full-list + per-record individual fetch if criteria returns nothing.

**UI pages:** `user_properties.html`

### 5.7 Property Creation (Owner)

**Endpoint:** `POST /api/properties/create` (authenticated)

**Fields accepted:**
- `title`, `description`
- `price` → `Price1`
- `prix_nuit` (nightly rate for short rentals)
- `loyer_mensuel` (monthly rent)
- `caution_courte` / `caution_longue` (deposit — short/long term)
- `type` (normalized to `For Sale` / `To Rent`)
- `location`, `address_line_1`, `address_line_2`, `city_district`
- `surface`, `bedrooms`, `bathrooms`, `floor`, `year_built`
- `status`
- `image` (URL or base64 data URI)
- `images` (array of base64 data URIs)

**Behavior:**
1. Sets `Validation_Status = 'pending'` automatically (agent review required).
2. Sets `User = req.session.userId` (owner).
3. Submits to Zoho Creator `Property` form.
4. If base64 images provided: saves locally to `/uploads/property-<ID>.<ext>` and attempts Zoho image field upload.
5. Clears property list cache on success.

**UI pages:** `owner_add_property.html`

### 5.8 Property Update (Owner)

**Endpoint:** `PATCH /api/properties/update/:id` (authenticated)

Allows partial update of allowed fields only: `title`, `description`, `location`, `Price1`, `prix_nuit`, `loyer_mensuel`, `caution_courte`, `caution_longue`, `Surface1`, `Rooms1`, `Bathrooms1`, `Floor`, `Year_Built`.

---

## 6. Reservation Flow (Rental)

### 6.1 Overview

A reservation is a time-bounded rental request for a `To Rent` property.

### 6.2 Creation

**Endpoint:** `POST /api/reservations/create` (authenticated)

**Required fields:** `property_id`, `start_date`, `end_date`

**Node.js sends to Zoho:**
```json
{
  "data": {
    "Start_Date": "<dd-MMM-yyyy>",
    "End_Date":   "<dd-MMM-yyyy>",
    "User":       "<session.userId>",
    "Property1":  "<property_id>"
  }
}
```

**Zoho Creator handles (via workflows):**
- `status&calcul`: sets `Status = 'En attente'`, computes `Duration_Text`, calculates rental amounts, sets `Advance_Amount` and `Payment_Deadline`.
- `Check_Property_Availability`: detects date conflicts with existing reservations; cancels if overlap.
- `status&calcul`: validates property type (rejects if not `To Rent`).

**Error surfacing:** If Zoho returns a workflow alert, Node.js extracts it via `extractWorkflowAlertMessage()` and returns it as a 400 error to the browser.

**UI pages:** `detail.html` (reservation form)

### 6.3 User's Reservations

**Endpoint:** `GET /api/reservations/user` (authenticated)

Fetches all records from `All_Reservations` report, filters by `User` lookup field matching `userId1` or `userId`.

**UI pages:** `user_reservations.html`

### 6.4 Owner's Incoming Reservations

**Endpoint:** `GET /api/reservations/owner` (authenticated)

Fetches owner's property IDs via `fetchOwnerPropertyIds()`, then returns all reservations where `Property1` matches any owner property.

**UI pages:** `owner_requests.html`

### 6.5 Reservation Cancellation (User)

**Endpoint:** `PATCH /api/reservations/:id/cancel` (authenticated)

PATCHes `Status = 'Annulé'` on the Zoho record. Tries BASE_V21 then BASE_CREATOR.

### 6.6 Reservation Status Values

| Status | Trigger |
|--------|---------|
| `En attente` | Set by `status&calcul` workflow on creation |
| `Confirmé` | Set by Node.js PATCH after advance payment (see §8) |
| `Annulé` | Set by user cancellation or availability conflict |

---

## 7. Purchase Flow (Sale)

### 7.1 Overview

A purchase request is a buyer's expression of interest in acquiring a `For Sale` property.

### 7.2 Creation

**Endpoint:** `POST /api/purchases/create` (authenticated)

**Required fields:** `property_id`  
**Optional fields:** `preference_de_contact` (default: `Email`), `message`, `seller_id`

**Seller resolution logic (Node.js):**
1. Try property from detail cache.
2. Try `property.User.ID`, `property.Added_User.ID`, `property.Owner.ID`, or `property.User` (string).
3. If not found: query `All_Properties` with `criteria=ID=="<property_id>"` and repeat.
4. Fall back to `seller_id` from frontend body.

**Node.js sends to Zoho:**
```json
{
  "data": {
    "Buyer":                "<session.userId>",
    "Property":             "<property_id>",
    "Preference_de_contact":"<Email|Phone|WhatsApp>",
    "Message":              "<message>",
    "Request_Date":         "<dd-MMM-yyyy>",
    "Seller":               "<resolved seller ID>"
  }
}
```

**Zoho Creator handles (via workflows):**
- `auto_set_purchase_fields`: sets `Status = 'En attente'`, `Advance_Amount`, `Payment_Deadline`.
- `notify_seller_on_purchase`: sends email notification to the seller.
- `contrat_apres_acceptation`: generates contract record once advance payment is confirmed.

**UI pages:** `detail.html` (purchase request form)

### 7.3 User's Purchases

**Endpoint:** `GET /api/purchases/user` (authenticated)

Filters `All_Purchases` by `Buyer` lookup field matching `userId1` or `userId`.

**UI pages:** `user_reservations.html` (shared tab)

### 7.4 Owner's Incoming Purchases

**Endpoint:** `GET /api/purchases/owner` (authenticated)

Returns purchases where `Seller` matches the logged-in user OR `Property` belongs to their property portfolio.

**UI pages:** `owner_requests.html`

### 7.5 Purchase Cancellation (User)

**Endpoint:** `PATCH /api/purchases/:id/cancel` (authenticated)

PATCHes `Statut = 'Annulée'`.

### 7.6 Purchase Status Values

| Status (field `Statut`) | Trigger |
|------------------------|---------|
| `En attente` | Set by `auto_set_purchase_fields` workflow |
| `Accepté` | Set by Node.js PATCH after advance payment (see §8) |
| `Annulée` | Set by user cancellation |

---

## 8. Advance Payment Flow

### 8.1 Purpose

Advance payment is the mechanism by which a reservation or purchase is confirmed. After paying the advance, the system automatically confirms the transaction and triggers contract generation.

### 8.2 Deadline Countdown

**Endpoints:**
- `GET /api/reservations/detail/:id` (authenticated) — returns full reservation record including `Payment_Deadline`.
- `GET /api/purchases/detail/:id` (authenticated) — returns full purchase record including `Payment_Deadline`.

`advance-payment.html` displays a live countdown timer:
- Shows `HH:MM:SS` remaining until `Payment_Deadline`.
- Turns red when less than 10 minutes remain.
- Shows an "expired" state with a gray card when deadline has passed.
- The deadline value comes from the Zoho record (set by workflow), not from the frontend.

### 8.3 Payment Submission

**Endpoint:** `POST /api/payments/advance` (authenticated)

**Body:** `{ type: 'reservation' | 'purchase', id: '<record ID>' }`

**Reservation flow (two sequential PATCHes with 1-second delay):**
1. `PATCH All_Reservations/:id` → `{ Advance_Payment_Status: 'Payé' }`
2. *(1000 ms delay)*
3. `PATCH All_Reservations/:id` → `{ Status: 'Confirmé' }` → triggers `generer_contrat_location` workflow

**Purchase flow (two sequential PATCHes with 1-second delay):**
1. `PATCH All_Purchases/:id` → `{ Advance_Payment_Status: 'Payé' }`
2. *(1000 ms delay)*
3. `PATCH All_Purchases/:id` → `{ Statut: 'Accepté' }` → triggers `generer_contrat_achat` workflow

The delay is necessary to let Zoho Creator process the first update before the second triggers a workflow that reads the first field.

**UI pages:** `advance-payment.html`

### 8.4 Payment Page Parameters

`advance-payment.html` reads `type` and `id` from URL query parameters (`?type=reservation&id=1234567890`). The page fetches the corresponding detail record, renders a summary card, and initiates the countdown.

---

## 9. Contract Management

### 9.1 Contract Generation

Contracts are **not created by Node.js**. They are created automatically by Zoho Creator workflows:
- `generer_contrat_location` — triggered when `Reservation.Status` is set to `Confirmé`.
- `generer_contrat_achat` — triggered when `Purchase.Statut` is set to `Accepté`.

### 9.2 User Contracts

**Endpoint:** `GET /api/contracts/user` (authenticated)

Matching logic (in priority order):
1. `contract.Buyer` lookup matches user's `userId` or `userId1`.
2. `contract.Reservation.ID` is in the user's reservation ID set.
3. `contract.Purchase.ID` is in the user's purchase ID set.
4. Fallback: shared property reference between contract and user's purchases/reservations.

Each matched contract is individually enriched with a full single-record fetch to include `Contrat_PDF_URL` and other file fields not returned in list reports.

**UI pages:** `user_contracts.html`

### 9.3 PDF Download Proxy

**Endpoint:** `GET /api/contracts/pdf-download?url=<zoho-sign-url>&id=<contractId>` (authenticated)

Fetches the PDF from Zoho Sign using the current OAuth token and streams it back to the browser as `attachment; filename="contrat-<id>.pdf"`.

### 9.4 Admin Contracts

**Endpoint:** `GET /api/admin/contracts`

Returns all contracts without user filtering (admin overview).

**UI pages:** `agent_contracts.html`, `user_contracts.html`

---

## 10. Payment Tracking

### 10.1 User Payments

**Endpoint:** `GET /api/payments/user` (authenticated)

Returns all payment records where:
- `payment.Contract` links to a contract the user owns, OR
- `payment.User` matches the session user, OR
- `payment.Buyer` matches the session user.

**UI pages:** `user_payments.html`

### 10.2 Payments by Contract

**Endpoint:** `GET /api/payments/contract/:contractId?altId=<id>` (authenticated)

1. Tries criteria query `Contract == "<contractId>"`.
2. Falls back to full-scan with multi-field matching (`Contract`, `Contrat`, `Lease`, `Bail`, etc.).

### 10.3 Payment Update

**Endpoint:** `PATCH /api/payments/update/:paymentId` (authenticated)

PATCHes arbitrary fields (from `req.body`) on the payment record. Used by the payment UI to mark installments as paid.

### 10.4 Invoice Link (Zoho Books)

**Endpoint:** `GET /api/payments/invoice-link/:paymentId` (authenticated)

Fetches the payment record to get `Zoho_Books_Invoice_ID`, then calls Zoho Books API to retrieve invoice details and constructs the customer portal URL.

---

## 11. Owner Dashboard

The owner role is not a distinct Zoho role — owners are `User` accounts who have listed at least one property. Their dedicated pages show only their own data.

### 11.1 Pages and Features

| Page | Feature |
|------|---------|
| `user_dashboard.html` | Overview: property count, reservation count, purchase count |
| `user_properties.html` | List of owner's listed properties, edit capability |
| `owner_requests.html` | Incoming reservation and purchase requests (read-only — no manual confirm/refuse; system auto-confirms after advance payment) |
| `owner_add_property.html` | Property submission form |

### 11.2 Owner Property ID Resolution

`fetchOwnerPropertyIds(req)` builds a `Set` of all identifiers (system IDs, ID1s, titles) for the logged-in owner's properties. This set is used to filter reservations and purchases by matching against their `Property` / `Property1` lookup fields.

---

## 12. Agent Dashboard

### 12.1 Pages and Features

| Page | Feature |
|------|---------|
| `agent_dashboard.html` | Summary KPIs, recent activity |
| `agent_validation.html` | List of pending properties; approve/reject actions |
| `agent_reservations.html` | All reservations table with status filter; detail modal; contract link |
| `agent_purchases.html` | All purchase requests |
| `agent_contracts.html` | All contracts; PDF download |
| `agent_profile.html` | Agent profile edit (via `POST /api/agent/profile/update`) |

### 12.2 Property Validation

Agents can:
- **Approve** a property → sets `Validation_Status = 'approved'` → property appears on public site.
- **Reject** a property → sets `Validation_Status = 'rejected'` AND deletes the record from Zoho.

Both actions are supported via chatbot (Nexia) as well as the dedicated admin/agent panel UI.

---

## 13. Admin Dashboard

### 13.1 Pages and Features

| Page | Feature |
|------|---------|
| `admin_dashboard.html` | Platform-wide KPIs; Zoho Analytics embed |
| `admin_users.html` | Full user list (all roles) |
| `admin_user_detail.html` | Single user detail + edit |
| `admin_properties.html` | All properties (published / pending / rejected) |
| `admin_chatbot.html` | Dedicated admin chatbot interface |

### 13.2 User Management (Admin)

| Action | Endpoint |
|--------|----------|
| List all users | `GET /api/admin/users` |
| Get user detail | `GET /api/admin/users/detail/:id` |
| Create user | `POST /api/admin/users/add` |
| Update user (role, password, etc.) | `POST /api/admin/users/update` |
| Delete user | `POST /api/admin/users/delete` |

**User deletion strategy (two-step fallback):**
1. Try workflow form (configured via `DELETE_USER_FORMS` env var).
2. Fall back to direct `DELETE` request on `All_Users` report (requires `ZohoCreator.report.DELETE` OAuth scope).

**User update strategy:**
Uses `updateUserDirect()` which tries 3 base URLs × {direct ID, ID1} PATCH, then falls back to criteria-based PATCH.

### 13.3 Property Management (Admin)

| Action | Endpoint |
|--------|----------|
| List all properties (categorized) | `GET /api/admin/properties` |
| Approve | `POST /api/admin/properties/approve` |
| Reject + delete | `POST /api/admin/properties/reject` |
| Delete | `POST /api/admin/properties/delete` |
| Get all reservations | `GET /api/admin/reservations` |
| Get all contracts | `GET /api/admin/contracts` |

**Approval/rejection strategy:**
1. Try configured workflow form (via `APPROVE_PROPERTY_FORMS` / `REJECT_PROPERTY_FORMS` env vars).
2. Fall back to direct PATCH on `Validation_Status` field using `updatePropertyValidationStatusDirect()`.

### 13.4 Cache Management

**Endpoint:** `POST /api/admin/cache/clear`

Clears all in-memory caches: `propertiesResponseCache`, `propertyDetailCache`, `reportCache`, `usersCache`, `ownerPropsCache`.

---

## 14. AI Chatbot — Nexia

### 14.1 Overview

"Nexia" is an AI assistant powered by **Groq API** using `llama-3.1-8b-instant`. It is accessible from all dashboard pages via the embedded `chatbot-widget.js`.

### 14.2 Endpoint

`POST /chat` — Body: `{ message: string (max 1000 chars) }`

### 14.3 Context Injection

On every request, Node.js:
1. Fetches the current approved property list from `GET /api/properties` (max 20 properties formatted as text).
2. Determines the session role (`admin`, `agent`, or public user).
3. Injects a role-specific system prompt into the Groq request.

### 14.4 Role-Based Behavior

| Role | Capabilities |
|------|-------------|
| Public / User | Answer questions about listed properties only. Cannot access any administrative data. |
| Agent | Can validate (`APPROVE_PROP`) or reject (`REJECT_PROP`) properties by ID. Can list pending properties (`LIST_PENDING`). |
| Admin | Full agent capabilities + delete properties (`DELETE_PROP`), delete users (`DELETE_USER`), list all users (`LIST_USERS`), show Zoho Analytics charts (`SHOW_CHART`). |

### 14.5 Action System

Groq returns action tags in its response: `[ACTION:TYPE:PARAM]`. Node.js detects and executes them:

| Action Tag | Description | Role |
|------------|-------------|------|
| `[ACTION:LIST_USERS]` | Fetches and formats all users | Admin |
| `[ACTION:LIST_PENDING]` | Lists pending properties | Admin, Agent |
| `[ACTION:APPROVE_PROP:<id>]` | Approves property | Admin, Agent |
| `[ACTION:REJECT_PROP:<id>]` | Rejects property | Admin, Agent |
| `[ACTION:DELETE_PROP:<id>]` | Deletes property from Zoho | Admin |
| `[ACTION:DELETE_USER:<id>]` | Deletes user from Zoho | Admin |
| `[ACTION:SHOW_CHART:<type>]` | Returns Zoho Analytics dashboard URL | Admin |

Action tags are stripped from the final reply text before it reaches the browser.

### 14.6 Chart Integration

When `SHOW_CHART` is triggered, the response includes:
```json
{
  "reply": "Voici le graphique ...",
  "chart": { "url": "<analytics_url>", "title": "<title>" }
}
```
The frontend widget renders the chart as an embedded iframe or link.

---

## 15. Image Management

### 15.1 Storage Strategy

Images use a dual-storage approach:
1. **Local disk** — saved to `/uploads/property-<ID>.<ext>` for fast serving.
2. **Zoho Creator image field** — uploaded via Zoho file upload API for persistence.

### 15.2 Image Proxy

**Endpoint:** `GET /api/media?url=<encoded-url>`

Proxies Zoho-hosted images (from `creator.zoho.com`, `creatorapp.zoho.com`, etc.) by fetching them server-side with the OAuth token and streaming them to the browser. This bypasses CORS restrictions on Zoho media URLs.

Only Zoho hostnames are allowed; external URLs are rejected (security guard).

Response: `Cache-Control: public, max-age=300` (5 minutes).

### 15.3 Image Download by Property

**Endpoint:** `GET /api/property-image/:recordId`

Serves the property image:
1. Checks local `/uploads/` directory first.
2. Falls back to Zoho field download (tries `IMAGE_FIELD_CANDIDATES` list in order).
3. Saves any downloaded Zoho image locally for future requests.
4. Response: `Cache-Control: public, max-age=86400` (24 hours).

### 15.4 Image Upload to Zoho

`uploadPropertyImageToZoho(recordId, dataUrl)` tries each known image field candidate until one accepts the upload. Remembers the first successful field as `preferredImageUploadField` for subsequent uploads.

### 15.5 Property Image Enrichment

Every property record returned by the API is enriched with:
- `image_url` — raw Zoho URL or local `/uploads/` path.
- `image_proxy_url` — `/api/media?url=...` proxied version (for Zoho URLs) or direct path.

---

## 16. API Endpoint Reference

### 16.1 Auth Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/auth-status` | None | Session check |
| POST | `/api/login` | None (rate-limited) | Login |
| POST | `/api/signup` | None | Register (step 1) |
| GET | `/api/auth/verify-email` | None | Verify email token (step 2) |
| POST | `/api/auth/resend-verification` | None | Resend verification email |
| POST | `/api/auth/forgot-password` | None (rate-limited) | Request password reset |
| POST | `/api/auth/verify-reset-token` | None | Validate reset token |
| POST | `/api/auth/reset-password` | None | Complete password reset |
| POST | `/api/logout` | None | Logout (JSON) |
| GET | `/api/logout` | None | Logout (redirect) |

### 16.2 Property Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/properties` | None | All approved properties |
| GET | `/api/properties/:id` | None | Single property detail |
| GET | `/api/properties/user` | Required | Logged-in owner's properties |
| GET | `/api/properties/:id/contact` | Required | Owner contact info + WhatsApp link |
| POST | `/api/properties/create` | Required | Create new property listing |
| PATCH | `/api/properties/update/:id` | Required | Update property fields |

### 16.3 Reservation Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/reservations/create` | Required | Submit reservation request |
| GET | `/api/reservations/user` | Required | Logged-in user's reservations |
| GET | `/api/reservations/owner` | Required | Reservations on owner's properties |
| GET | `/api/reservations/detail/:id` | Required | Full reservation record (deadline fetch) |
| PATCH | `/api/reservations/:id/cancel` | Required | Cancel reservation |

### 16.4 Purchase Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/purchases/create` | Required | Submit purchase request |
| GET | `/api/purchases/user` | Required | Logged-in user's purchases |
| GET | `/api/purchases/owner` | Required | Purchases on owner's properties |
| GET | `/api/purchases/detail/:id` | Required | Full purchase record (deadline fetch) |
| PATCH | `/api/purchases/:id/cancel` | Required | Cancel purchase request |

### 16.5 Contract Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/contracts/user` | Required | User's contracts (enriched) |
| GET | `/api/contracts/pdf-download` | Required | Stream contract PDF |
| GET | `/api/admin/contracts` | None | All contracts (admin) |

### 16.6 Payment Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/payments/user` | Required | User's payment records |
| GET | `/api/payments/contract/:contractId` | Required | Payments for a contract |
| PATCH | `/api/payments/update/:paymentId` | Required | Update payment record |
| GET | `/api/payments/invoice-link/:paymentId` | Required | Zoho Books invoice link |
| POST | `/api/payments/advance` | Required | Confirm advance payment |

### 16.7 Admin Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/admin/users` | None* | All users |
| GET | `/api/admin/users/detail/:id` | None* | User detail |
| POST | `/api/admin/users/add` | None* | Create user |
| POST | `/api/admin/users/update` | None* | Update user |
| POST | `/api/admin/users/delete` | None* | Delete user |
| GET | `/api/admin/properties` | None* | All properties (categorized) |
| POST | `/api/admin/properties/approve` | None* | Approve property |
| POST | `/api/admin/properties/reject` | None* | Reject + delete property |
| POST | `/api/admin/properties/delete` | None* | Delete property |
| GET | `/api/admin/reservations` | None* | All reservations |
| POST | `/api/admin/cache/clear` | None* | Clear all in-memory caches |

*Admin endpoints currently do not enforce server-side role check — access control relies on frontend session guard. This is a known gap and should be addressed by adding `requireAuth` + role assertion middleware.

### 16.8 Agent Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/agent/profile` | Required | Agent's own profile |
| POST | `/api/agent/profile/update` | Required | Update agent's profile |

### 16.9 Media Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/media?url=<url>` | None | Image proxy for Zoho media |
| GET | `/api/property-image/:recordId` | None | Property image (local or Zoho) |

### 16.10 Chatbot

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/chat` | None | Groq AI chatbot endpoint |

---

## 17. Zoho Creator Workflow Reference

All workflows are Deluge scripts configured inside Zoho Creator. Node.js **never replicates** their logic.

| Workflow Name | Form/Report Trigger | What It Does |
|---------------|---------------------|--------------|
| `Add_User` | `User` form on create | Validates password strength, checks email uniqueness, sets default role, hashes password (if implemented) |
| `sync_user_to_crm` | `User` form on create | Creates corresponding contact in Zoho CRM |
| `status&calcul` | `Reservation` form on create | Sets `Status = 'En attente'`, computes `Duration_Text`, calculates amounts, sets `Advance_Amount`, `Payment_Deadline` |
| `Check_Property_Availability` | `Reservation` form on create | Checks date conflicts; cancels reservation if overlap detected |
| `auto_set_purchase_fields` | `Purchase` form on create | Sets `Status = 'En attente'`, computes `Advance_Amount`, sets `Payment_Deadline` |
| `notify_seller_on_purchase` | `Purchase` form on create | Emails seller notification of new purchase request |
| `generer_contrat_location` | `Reservation` on `Status = 'Confirmé'` | Creates a `Contract` record (rental contract) |
| `generer_contrat_achat` | `Purchase` on `Statut = 'Accepté'` | Creates a `Contract` record (sale contract) |
| `send_email_direct` (Custom API) | Called directly via Custom API URL | Sends verification email (to_email, to_name, verify_link) |

---

## 18. Frontend Pages Reference

### 18.1 Public Pages (unauthenticated)

| File | Purpose |
|------|---------|
| `index.html` | Landing page — featured listings, hero section |
| `annonces.html` | Full property search/filter listing |
| `detail.html` | Property detail — photos, specs, reservation/purchase forms |
| `apropos.html` | About the agency |
| `contact.html` | Contact form |
| `login.html` | Login form |
| `inscription.html` | Registration form (step 1 of email verification) |
| `verify-email.html` | Email verification landing (step 2) |
| `reset.html` | Password reset (request + confirm) |

### 18.2 User (Tenant/Buyer) Pages

| File | Purpose |
|------|---------|
| `user_dashboard.html` | Personal dashboard — KPIs, recent activity |
| `user_properties.html` | Properties owned/listed by the user |
| `user_reservations.html` | User's rental reservations + purchase requests |
| `user_contracts.html` | User's generated contracts |
| `user_payments.html` | Payment schedule and history |
| `advance-payment.html` | Advance payment UI with countdown timer |
| `profile.html` | Profile edit page |
| `payment.html` | Payment method selection |
| `owner_add_property.html` | Property submission form |
| `owner_requests.html` | Incoming reservations/purchases on user's properties |

### 18.3 Agent Pages

| File | Purpose |
|------|---------|
| `agent_dashboard.html` | Agent KPI overview |
| `agent_validation.html` | Pending property validation queue |
| `agent_reservations.html` | All reservations — status filter, detail modal |
| `agent_purchases.html` | All purchase requests |
| `agent_contracts.html` | All contracts |
| `agent_profile.html` | Agent profile edit |

### 18.4 Admin Pages

| File | Purpose |
|------|---------|
| `admin_dashboard.html` | Platform-wide stats, Zoho Analytics embed |
| `admin_users.html` | Full user list with CRUD |
| `admin_user_detail.html` | Single user detail and edit |
| `admin_properties.html` | All properties by status |
| `admin_chatbot.html` | Dedicated admin Nexia interface |

### 18.5 Shared JS Files

| File | Purpose |
|------|---------|
| `auth-helper.js` | Navbar auth rendering, post-login redirect, logout, `requireAuth` |
| `chatbot-widget.js` | Embedded chatbot widget (injected on every page) |
| `detail.js` | Property detail page logic |
| `backend-utils.js` | Shared server utilities (imported by `api-proxy.js`) |

---

## 19. Non-Functional Requirements

### 19.1 Security

| Requirement | Implementation |
|-------------|----------------|
| HTTP security headers | `helmet` middleware (CSP disabled for Zoho embeds) |
| Rate limiting on login | 10 requests / 15 min per IP |
| Rate limiting on forgot-password | 5 requests / 15 min per IP |
| Image proxy host whitelist | Only `creator.zoho.com`, `creatorapp.zoho.com`, `www.zohoapis.com` |
| Session fixation | `express-session` with regeneration on login |
| CSRF | Not yet implemented — should be added for state-changing endpoints |
| Role-based endpoint protection | Client-side only for admin endpoints (gap — should add server-side middleware) |
| Password storage | Plain text in Zoho Creator (gap — should hash via Deluge workflow) |

### 19.2 Performance

| Requirement | Implementation |
|-------------|----------------|
| Response compression | `compression` middleware on all responses |
| Property list cache | 15 s in-memory, avoids repeated Zoho calls on page load |
| Property detail cache | 15 s in-memory |
| Image CDN caching | `Cache-Control: public, max-age=86400` on property images |
| Request deduplication | `fetchZohoJsonDeduped()` — simultaneous identical GET requests share one in-flight promise |
| OAuth token reuse | Token refreshed only when < 2 minutes from expiry; cooldown if Zoho returns 429 |

### 19.3 Availability

| Requirement | Implementation |
|-------------|----------------|
| Graceful shutdown | `SIGTERM` / `SIGINT` handlers close HTTP server cleanly |
| Zoho fallback | 3-URL multi-base fallback on every API call |
| Retry with backoff | Exponential backoff (1 s, 2 s, 4 s) on retryable Zoho errors |
| Offline detection | `isOfflineError()` — skips retry on DNS/connection errors |
| Startup token validation | OAuth token refreshed on server start; fails loudly if refresh token is invalid |

### 19.4 Reliability

| Requirement | Implementation |
|-------------|----------------|
| Unhandled rejection guard | `process.on('unhandledRejection', ...)` |
| Uncaught exception guard | `process.on('uncaughtException', ...)` |
| Port conflict detection | `EADDRINUSE` handler with clear error message |
| Pending signup cleanup | Interval every 1 hour deletes expired pending signup tokens |

### 19.5 Scalability Limitations

- **In-memory state** (`pendingSignups`, caches, OAuth token) is process-local. Running multiple Node.js instances requires an external store (Redis) for session + cache + pending signups.
- **Max 200 Zoho records** per report fetch — pagination not implemented.

---

## 20. Technical Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js (version: compatible with ES2020) |
| Web framework | Express.js |
| Session | `express-session` (in-memory store) |
| HTTP client | `node-fetch` v2 |
| Email | `nodemailer` (SMTP) + Zoho Creator Custom API for verification emails |
| Security | `helmet`, `express-rate-limit` |
| Compression | `compression` |
| File uploads | `form-data`, `fs` (local `/uploads/` directory) |
| AI / Chatbot | Groq Cloud API — LLaMA 3.1 8B Instant |
| Backend data | Zoho Creator (low-code database + Deluge workflows) |
| CRM | Zoho CRM (synced via Zoho workflow) |
| Invoicing | Zoho Books |
| Analytics | Zoho Analytics (embedded iframe dashboard) |
| Frontend | Vanilla HTML/CSS/JavaScript (no framework) |
| Styling | Custom CSS (`styles.css`, `styles_agent.css`, inline) |

---

## 21. Environment Configuration

All runtime parameters are loaded from `.env` via `loadEnvFile()`.

| Variable | Purpose | Default |
|----------|---------|---------|
| `PORT` | HTTP server port | `3000` |
| `SESSION_SECRET` | Express session encryption key | `change-me-in-production` |
| `ZOHO_ACCESS_TOKEN` | Initial access token (refreshed automatically) | — |
| `ZOHO_CLIENT_ID` | OAuth client ID | — |
| `ZOHO_CLIENT_SECRET` | OAuth client secret | — |
| `ZOHO_REFRESH_TOKEN` | OAuth refresh token | — |
| `ZOHO_API_DOMAIN` | Zoho API domain | `www.zohoapis.com` |
| `ZOHO_ACCOUNTS_DOMAIN` | Zoho OAuth domain | `accounts.zoho.com` |
| `ZOHO_REPORT_LINK_NAME` | Properties report name | `All_Properties` |
| `ZOHO_ANALYTICS_DASHBOARD_URL` | Analytics embed URL | *(hardcoded fallback)* |
| `GROQ_API_KEY` | Groq AI API key | — |
| `SMTP_HOST` | SMTP server | — |
| `SMTP_PORT` | SMTP port | `587` |
| `SMTP_SECURE` | Use TLS | `false` |
| `SMTP_USER` | SMTP username | — |
| `SMTP_PASS` | SMTP password | — |
| `SMTP_FROM` | From address | `SMTP_USER` |
| `APP_BASE_URL` | Public app URL (for email links) | `http://localhost:3000` |
| `FALLBACK_USER_ID` | Fallback if session has no userId | — |
| `PROPERTIES_CACHE_TTL_MS` | Property list cache TTL | `15000` |
| `PROPERTY_DETAIL_CACHE_TTL_MS` | Property detail cache TTL | `15000` |
| `IMAGE_FIELDS_TTL_MS` | Image field detection cache TTL | `3600000` |
| `PROPERTY_VALIDATION_FIELD` | Zoho field name for validation status | `Validation_Status` |
| `PROPERTY_PENDING_VALUE` | Value meaning "pending" | `pending` |
| `PROPERTY_APPROVED_VALUE` | Value meaning "approved" | `approved` |
| `PROPERTY_REJECTED_VALUE` | Value meaning "rejected" | `rejected` |
| `ADMIN_PROPERTIES_REPORT_LINK_NAME` | Report for admin property list | `All_Properties` |
| `PROPERTY_FORM_LINK_NAME` | Form for property creation | `Property` |
| `DELETE_USER_WORKFLOW_FORMS` | Comma-separated workflow form names for user deletion | — |
| `DELETE_USER_WORKFLOW_FIELD` | Field to pass to deletion workflow | `User_ID` |
| `DELETE_PROPERTY_WORKFLOW_FORMS` | Workflow form names for property deletion | — |
| `DELETE_PROPERTY_WORKFLOW_FIELD` | Field passed to workflow | `Property_ID` |
| `APPROVE_PROPERTY_WORKFLOW_FORMS` | Workflow form names for approval | — |
| `APPROVE_PROPERTY_WORKFLOW_FIELD` | Field passed to approval workflow | `Property_ID` |
| `REJECT_PROPERTY_WORKFLOW_FORMS` | Workflow form names for rejection | — |
| `REJECT_PROPERTY_WORKFLOW_FIELD` | Field passed to rejection workflow | `Property_ID` |

---

*Document generated from source code analysis of `api-proxy.js` and all frontend HTML files.*  
*Platform: GI Immobilier — Tunisia*
