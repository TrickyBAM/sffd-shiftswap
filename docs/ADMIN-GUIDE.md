# ShiftSwap Admin Guide

This guide is for ShiftSwap admins: approving people, keeping the roster up to
date, helping members who are locked out, and handling problem trades.

**Opening the admin area:** sign in, then tap the **shield icon** at the top
right of any screen (only admins see it). The admin area has five tabs:

| Tab | What it's for |
|---|---|
| **Approvals** | People waiting to be let in, and who joined recently |
| **Members** | Everyone who has signed up: edit details, suspend, make admin, reset password |
| **Roster** | The department list that new sign-ups are matched against |
| **Trades** | Every post and trade: cancel posts, void trades |
| **Activity** | A log of everything important that happened, and who did it |

Every admin action is recorded in the activity log with your name.

---

## 1. Approving and rejecting new members

**How people get in:**

1. They sign up with their email and a password, then fill in their name, phone,
   rank, station, tour and (ideally) employee ID.
2. ShiftSwap compares them with the roster. If they clearly match one roster
   entry, they are **approved automatically** and you get an alert saying so.
3. If they don't match, they wait on a "pending" screen and **you get an alert**
   with their name, rank, station, phone and email, so you can reach out.

**What counts as a match:** exactly one roster entry with the same first and
last name (a first initial on the roster also counts). Every detail the roster
entry has (employee ID, rank, station, tour, email) must agree with what they
typed, and at least two of those details must match, or the employee ID alone.
A blank employee ID counts as a difference when the roster has one, so tell
people to enter it. Automatic approval is only tried on someone's first three
attempts. After that, you decide.

**To approve or reject:**

1. Open **Approvals**. Each card shows what the person entered and, when there
   is one, the closest roster entry and what was different (for example
   "Roster: John Smith, Station 19, tour differs").
2. If you're not sure it's really them, call or text them from the card.
3. Tap **Approve**. You can link them to their roster entry, or approve without a
   roster match (for someone new who isn't on the list yet).
4. Or tap **Reject** and give a short reason. They see the reason on their
   screen. You can approve them later from **Members** if it was a mistake.

The approved member gets an alert and can start using ShiftSwap right away,
after they read and accept the TeleStaff notice once.

**Check the auto-approvals:** now and then, look at "recently joined" on the
Approvals tab to make sure everyone who got in automatically belongs there.

---

## 2. The roster

The roster is the department list that sign-ups are checked against. Only
admins can see it.

### CSV format

Use a spreadsheet (Excel, Numbers or Google Sheets) and save or download it as
**CSV**. You can also copy the cells and paste them into the box on the Roster
tab.

The **first row must be column headings**. Only the names are required. Add as
many of the other columns as you have: the more details, the better the
automatic matching.

| Column heading | Required? | Examples | Notes |
|---|---|---|---|
| `First Name` | yes* | `John` | |
| `Last Name` | yes* | `Smith`, `O'Brien-Lee` | |
| `Name` | *instead of first + last | `Smith, John` or `John Smith` | Use either first + last columns or one Name column |
| `Employee ID` | no | `12345` | Best single way to match someone |
| `Rank` | no | `Firefighter`, `Paramedic`, `Lieutenant`, `Captain`, `Battalion Chief`, `Division Chief` | Short forms work too: FF, PM, Lt, Capt, BC, DC |
| `Station` | no | `19`, `Station 19`, `Airport 1` | Airport stations are Airport 1 to 3 (or 101 to 103) |
| `Tour` | no | `7`, `Tour 7` | 1 to 31. Leave blank, or write `none` or `relief`, for members without a tour |
| `Email` | no | `jsmith@example.com` | |
| `Phone` | no | `415-555-0100` | |

Other spellings of the headings are understood too (for example `Emp #`,
`Stn`, `Cell`). Commas, tabs or semicolons can separate the columns. Up to 5,000
rows per upload.

Example:

```csv
First Name,Last Name,Employee ID,Rank,Station,Tour,Email,Phone
John,Smith,12345,Firefighter,19,7,jsmith@example.com,415-555-0100
Maria,Lopez,23456,Lieutenant,Airport 2,,mlopez@example.com,
```

### Uploading

1. Open **Roster** and choose your CSV file (or paste the cells into the box).
2. ShiftSwap checks every row **before anything is saved** and shows a
   preview: the rows it will import, plus any rows with problems and the line
   number of each (for example a station that doesn't exist, or the same
   person listed twice). Fix those in your spreadsheet and try again, or go
   ahead without them.
3. Choose how to import:
   - **Add and update** (normal): new people are added and existing entries
     (same name and employee ID) are updated.
   - **Replace**: first deletes every roster entry that nobody has claimed yet,
     then imports. Use this when you have a complete new list. Entries already
     linked to a member are never deleted.
4. Confirm. You'll see how many rows were added, updated and skipped.

Uploading a roster doesn't approve anyone who is already waiting. Approve them
from **Approvals**. From now on, new sign-ups are matched against the new list.

You can search the roster and delete single entries on the Roster tab. An entry
shows who claimed it, if anyone.

---

## 3. Resetting a password

ShiftSwap sends no emails, so there is no "forgot password" link. Members who
are locked out ask an admin.

1. **Make sure it's really them.** Call them back on the number in their
   profile, or check with them in person.
2. Open **Members**, find them (search by name) and tap **Reset password**.
3. ShiftSwap shows a **temporary password** once, something like
   `Harbor-Maple-4821`. Read it to them or text it. It is not stored anywhere,
   so if you lose it, reset again.
4. They sign in with it and are asked to choose a new password straight away.

You can't reset your own password this way. Use **Change password** on your
Profile page, or ask another admin.

---

## 4. Editing, suspending and reactivating members

**Edit details:** in **Members**, open a member to fix their name, rank,
station, tour, phone or employee ID. Members can change their own phone,
station and tour, but name, rank and employee ID are admin-only.

**Suspend:** tap **Suspend** and give a reason. The member can no longer use
ShiftSwap (they see the reason). When you suspend someone:

- Their **upcoming open posts are cancelled** and their **pending requests are
  closed**. Everyone affected is told.
- Their **confirmed trades stay**. If a trade shouldn't happen, void it in
  **Trades** (section 6).

**Reactivate:** open the member and tap **Reactivate** to let them back in.

---

## 5. Making another admin

1. Open **Members**, find the person, and tap **Make admin**.
2. They get the shield icon and full admin access the next time a page loads.

To take admin away, tap **Remove admin**. ShiftSwap always keeps at least one
admin, so you can't remove the last one. Make someone else an admin first.

(The very first admin is created by a developer with a script. See
`docs/DEPLOY.md`.)

---

## 6. Cancelling posts and voiding trades

Open **Trades** to see every post and trade. Search or filter by date, station
or member.

- **Cancel a post** (an open shift nobody has been confirmed for yet): tap
  **Cancel post** and give a reason. The poster and anyone who asked for it are
  told.
- **Void a trade** (a confirmed trade): tap **Void trade** and give a reason.
  Both members are told. This works even after the shift has started (members
  can't undo a started trade themselves). For a SwapMatch, both days are undone
  together.

ShiftSwap won't void a trade if undoing it would put someone on two shifts the
same day (for example, they picked up another shift on the day they would get
back). The message tells you. Sort out the other trade first.

Remember that voiding in ShiftSwap doesn't change TeleStaff. If the trade was
already entered there, it has to be fixed there too.

---

## 7. The activity log

**Activity** lists important events, newest first: sign-ups and roster matches,
approvals and rejections, suspensions, role changes, password resets, roster
uploads, posts, confirmed trades, cancellations and voids. Each entry shows who
did it and when.

Use it to answer questions like "who approved this person?", "when was this
trade cancelled, and by whom?" or "why is this person pending?" (the roster note
explains what didn't match).

---

## 8. If ShiftSwap is down

First, remind everyone that **TeleStaff and the phone still work**. ShiftSwap
is only a coordination tool.

1. **Check the health page:** open
   <https://sffd-shiftswap.vercel.app/api/keepalive>.
   - `"ok": true` means the app and database are up. The problem may be the
     person's phone or connection. Ask them to close and reopen the app, or check
     their signal.
   - `"ok": false` (or the page doesn't load at all) means something is wrong.
     The `reason` says what.
2. **You may already have an email.** Every day, GitHub checks the app. If the
   check fails, GitHub emails you with "Keepalive" in the subject.
3. **Common causes and fixes:**
   - **The database was paused** (the reason mentions paused, or couldn't reach
     the database). Free databases pause after about a week with no activity.
     Open Vercel ▸ the sffd-shiftswap project ▸ **Storage** ▸ open the Supabase
     database. If it says paused, choose **Restore** or **Resume**. It takes a few
     minutes.
   - **A new version broke something.** Open Vercel ▸ sffd-shiftswap ▸
     **Deployments**, find the last version that worked, and choose **Instant
     Rollback** (or **Promote to Production**). The steps are in `docs/DEPLOY.md`.
   - **Vercel or Supabase itself is down.** Check <https://www.vercel-status.com>
     and <https://status.supabase.com>. Wait for them to fix it.
4. **Still stuck?** Hand the problem to a developer or AI agent and point them at
   `HANDOFF.md` and `docs/DEPLOY.md`. Tell them what the health page said and
   when it started.

**Alerts not arriving, but everything else works:** ask the member to turn
alerts off and on again in their Profile. On iPhone, alerts only work when
ShiftSwap is installed on the home screen. If nobody gets alerts, the push
settings may be missing (see "Push alerts" in `docs/DEPLOY.md`). Alerts always
appear inside the app either way.
