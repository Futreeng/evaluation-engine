# futureEng Growth Engine — Business Operations Checklist

*Practical guidance for running a legitimate SaaS startup (not technical advice - consult professionals as needed)*

---

## Phase 1: Foundation (Before Revenue)

### Legal & Compliance
- [ ] **Business Entity** — Form LLC or C-Corp (LLC is simpler for startups, ~$50-150/state + annual filing)
- [ ] **Tax ID (EIN)** — Get from IRS (free, takes ~15 min online at irs.gov)
- [ ] **Business Bank Account** — Separate from personal (required for legitimate business)
- [ ] **Terms of Service** — Draft (Termly or similar templates ~$100/yr, or hire lawyer)
- [ ] **Privacy Policy** — Required if collecting email/social data (~$50-200)
- [ ] **Data Handling** — Document what you collect, how long you keep it, compliance with GDPR/CCPA
  - You're analyzing Twitter handles + emails → need clear privacy policy
  - Consider: Do you store tweet data? Delete after report? User consent?

### Financial
- [ ] **Accounting Software** — Stripe/Square handles payments; use QuickBooks Self-Employed (~$10/mo) or Xero (~$12/mo) for bookkeeping
- [ ] **Pricing Decision** — Currently $0/$39/$99/$249/mo; get early feedback before charging
- [ ] **Payment Processing** — Stripe live keys (not test) for real payments (~2.9% + $0.30/transaction)
- [ ] **Invoice System** — Use Stripe for invoicing or Wave (free)

### Product Readiness
- [ ] **Real API Keys** — Ensure all 4 LLM providers have real keys (not exhausted)
- [ ] **Instagram/TikTok Support** — Nice-to-have but Twitter/X MVP is sufficient
- [ ] **Error Handling** — When APIs fail, tell customer clearly (don't hide errors)
- [ ] **Data Validation** — Verify handle exists before running evaluation (don't charge for failed requests)

---

## Phase 2: MVP Launch (Getting First Customers)

### Customer Acquisition
- [ ] **Landing Page** — Explain what futureEng does in 30 seconds (not technical)
  - "Get a free audit of your social media. See where you're winning and your biggest growth opportunity."
- [ ] **Early Testers** — Recruit 5-10 friends/founders to use free tier, give feedback
- [ ] **Social Proof** — Collect 1-2 testimonials (even from beta testers) before paid launch
- [ ] **Founder Message** — Be authentic - "I built this to help small businesses grow on social"

### Money Handling (First Principles)
- [ ] **Free Tier First** — Launch free tier only (0/$39/$99/$249 model, but gate paid features)
- [ ] **Soft Launch** — Don't charge until you have 3-5 paid customers willing to pay
- [ ] **Payment Method** — Stripe or Lemonsqueezy (easier for SaaS)
- [ ] **Refund Policy** — Decide upfront (e.g., "30-day refund, no questions")
- [ ] **Billing Cycles** — Monthly OK for MVP; annual (with discount) can come later

### Customer Communication
- [ ] **Contact Method** — Email or Slack (not phone yet - saves time at MVP stage)
- [ ] **Response Time** — Aim for 24-hour response; document FAQ
- [ ] **Feedback Loop** — Every customer conversation = feature/UX input (write notes)
- [ ] **Onboarding** — Write 1-page "How to use futureEng" guide (you've got TEAM_GUIDE - adapt it)

---

## Phase 3: Early Revenue (First Paid Customers)

### Money Tracking
- [ ] **Monthly Recurring Revenue (MRR)** — Track weekly; know exactly how much steady income you have
- [ ] **Churn Rate** — How many customers cancel? (Aim: <5% monthly for healthy SaaS)
- [ ] **Customer Acquisition Cost (CAC)** — How much did you spend to get each paying customer?
- [ ] **Profit Margin** — Revenue - (API costs + hosting + payment processing) = profit
  - Each evaluation costs $0.01-0.50 in LLM API fees (rough estimate)
  - If you charge $39/mo, customer can run ~78-100 audits/month (plenty of margin)

### Tax & Legal at Revenue
- [ ] **Quarterly Tax Estimate** — Set aside 25-30% of profit for taxes (if sole proprietor/LLC)
- [ ] **Sales Tax** — Many states require SaaS tax filing (varies; research your state)
- [ ] **Customer Data** — Document retention policy (delete after 90 days? Keep forever? User choice?)
- [ ] **Terms Update** — Update ToS to mention LLM-powered analysis, data usage, limitations

### Metrics to Track
| Metric | Why | Target |
|--------|-----|--------|
| Signups/week | Growth pace | 5-10/week |
| Free-to-paid % | Conversion | 5-15% |
| Trial length | Engagement | <7 days before buying |
| API costs/customer | Unit economics | <$5/customer/mo |
| Support tickets/customer | Product quality | <1/customer |

---

## Phase 4: Scale (5+ Paying Customers)

### Hiring/Outsourcing
- **DON'T** hire full-time yet (expensive at small scale)
- **DO** consider: Contract support person, designer, or marketer (~$500-2000/mo)
- **Self**: Focus on product + customer success (your best ROI right now)

### Product Direction
- [ ] **Feature Requests** — Document all; prioritize by "would you pay more for this?"
- [ ] **Instagram/TikTok** — If customers ask enough, add it (reuse Twitter fetcher pattern)
- [ ] **Benchmarks** — Move from mock data to real industry data (hire someone to research)
- [ ] **Integrations** — Stripe webhooks, email notifications, Slack integration (future)

### Money & Ops
- [ ] **Raise Prices** — If demand > supply, raise prices ($49→$59/$99→$129 etc.)
- [ ] **Enterprise Tier** — Add $500-2000/mo tier for agencies or larger companies
- [ ] **Annual Plan** — Offer 25% discount for yearly payment (improves cash flow)
- [ ] **Accounting** — Hire bookkeeper (~$500/mo) if >$10k/mo revenue

---

## Principles for Early Stage (Everyone Stumbles on This)

### What to Do
1. **Talk to customers daily** — They'll tell you what to build (listen)
2. **Track money obsessively** — Spreadsheet, not guessing (know your MRR every week)
3. **Focus on one platform** — Twitter/X first; add others later
4. **Charge when ready** — Free→paid transition is when you learn what customers really want
5. **Separate personal/business** — Business bank account, business email, business phone (if applicable)
6. **Document decisions** — "Why did we price at $39?" → helps when making next decision

### What NOT to Do
- **Don't hire too early** — First 3 people should be customers/co-founders only
- **Don't build "nice-to-haves"** — Ruthlessly cut features; ship core MVP
- **Don't ignore churn** — If customers leave, find out why (email them)
- **Don't mix personal and business money** — Creates tax nightmare + you'll fail
- **Don't panic on slow weeks** — Early traction is lumpy (1 week slow, 1 week 10 signups)

---

## Your First Month Checklist

- [ ] LLC formed + EIN obtained
- [ ] Business bank account opened
- [ ] Stripe test keys → Stripe live keys
- [ ] Privacy Policy written
- [ ] Landing page live (describe futureEng simply)
- [ ] Free tier working for 5+ beta users
- [ ] Spreadsheet tracking: signups, free trials started, paid conversions
- [ ] Email address for customer support (even if it's just you)
- [ ] Document: "Why we built futureEng" (your founder story for customers)
- [ ] Haron builds UI using TEAM_GUIDE as reference

---

## Resources (Free or Cheap)

| Need | Tool | Cost |
|------|------|------|
| Business formation | LegalZoom / Stripe Atlas | $99-500 one-time |
| Accounting | Wave / Xero | Free - $30/mo |
| Invoicing | Stripe / Wave | Free |
| Landing page | Webflow / Carrd | $14-20/mo |
| Email | Gmail for Business | $6/mo |
| CRM (track customers) | Airtable / HubSpot Free | Free |
| Help desk | Freshdesk / Typeform | Free-$15/mo |

---

## Decision You Need to Make This Week

1. **Business Structure** — LLC or C-Corp? (LLC is 80% of startups' choice, simpler)
2. **First Pricing** — Launch free + $39/mo tier, or free only?
3. **Launch Date** — When do you want 5 beta users testing live?

Everything else follows from those three.

---

**Remember:** Thousands of founders have been exactly where you are. The fact that you're asking "how do I do this right" means you're already ahead.

Start small, listen hard, move fast.
