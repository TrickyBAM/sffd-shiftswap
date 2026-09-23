# ShiftSwap Admin Guide

This guide is for ShiftSwap admins: approving people, keeping the roster up to
date, helping members who are locked out, removing accounts when someone asks,
and handling problem trades. Button and screen names in **bold** are exactly
what you see in the app.

**Opening the admin area:** sign in, then tap the **shield icon** at the top
right of any screen (only admins see it), or go to **Profile ▸ Admin tools**.
The admin area has five tabs:

| Tab | What it's for |
|---|---|
| **Approvals** | People waiting to be let in, and who joined recently |
| **Members** | Everyone who has signed up: edit details, suspend, reactivate, make admin, reset password, remove an account |
| **Roster** | The department list that new sign-ups are matched against |
| **Trades** | Every post and trade: take down posts, void trades, export to CSV |
| **Activity** | A log of everything important that happened, and who did it |

Under the tabs, a row of counts shows **Waiting** (sign-ups waiting for you,
highlighted in red when there are any), **Members**, **Open posts**, **Trades
this month** and **On roster**. Tap a count to jump to it. On a small phone the
tabs and counts scroll sideways.

Every admin action is recorded in the activity log with your name.

---

## 1. Approving and rejecting new members

**How people get in:**

1. They create an account with their name, email, mobile phone and a password,
   then fill in their rank, station, tour and (ideally) employee ID.
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

1. Open **Approvals**. Under **Waiting for approval**, each card shows what the
   person entered and a **Roster check** with the closest roster entry and what
   was different (for example "Roster: John Smith, Station 19, tour differs").
2. If you're not sure it's really them, tap **Call**, **Text** or **Email** on
   the card.
3. Tap **Approve**. Pick their roster entry (the likely one is marked **Closest
   match**; use **Search the roster** if it isn't listed), or choose **Don't link
   a roster entry** for someone new who isn't on the list yet. Then tap
   **Approve**.
4. Or tap **Reject**, give a short reason and tap **Reject**. They see the
   reason on their screen. You can still approve them later from **Members**.

The approved member gets an alert and can start using ShiftSwap right away,
after they read and accept the TeleStaff notice once.

**Check the auto-approvals:** now and then, look at **Recently joined** on the
Approvals tab (everyone approved in the last 14 days, marked **On roster** or
**Not on roster**, and **Auto-approved** or who approved them) to make sure
everyone who got in automatically belongs there.

---

## 2. The roster

The roster is the department list that sign-ups are checked against. Only
admins can see it.

### CSV format

Use a spreadsheet (Excel, Numbers or Google Sheets) and save or download it as
**CSV**. You can also copy the cells and paste them into the box on the Roster
tab. **Download template** gives you an empty file with the right headings.

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

Other spellings of the headings are understood too (for example `first_name`,
`Emp #`, `Stn`, `Cell`). Commas, tabs or semicolons can separate the columns. Up
to 5,000 rows per upload.

Example:

```csv
First Name,Last Name,Employee ID,Rank,Station,Tour,Email,Phone
John,Smith,12345,Firefighter,19,7,jsmith@example.com,415-555-0100
Maria,Lopez,23456,Lieutenant,Airport 2,,mlopez@example.com,
```

### Uploading

1. Open **Roster**. Under **Upload the roster**, tap **Choose a CSV file**, or
   paste the cells into **Or paste it here**.
2. ShiftSwap checks every row **before anything is saved** and shows a
   preview: the rows it will import, plus any lines with problems and the line
   number of each (for example a station that doesn't exist, or the same
   person listed twice). Fix those in your spreadsheet and try again, or go
   ahead without them.
3. Decide about **Replace the current roster** (a tick box):
   - **Leave it off** (normal): new people are added and existing entries
     (same name and employee ID) are updated.
   - **Tick it** when you have a complete new list: every roster entry that
     nobody has claimed yet is removed first, then the file is imported.
     Entries already linked to a member are never removed.
4. Tap **Import N people** (with **Replace the current roster** ticked, confirm
   with **Replace and import N people**). You'll see how many were added,
   updated, already up to date and not imported.

Uploading a roster doesn't approve anyone who is already waiting. Approve them
from **Approvals**. From now on, new sign-ups are matched against the new list.

Below the upload box you can search the roster, **Show** everyone, only people
**Not signed up yet** or only entries **Linked to a member**, and remove a
single entry with its trash-can button. An entry shows who claimed it, if
anyone.

---

## 3. Resetting a password

ShiftSwap sends no emails, so there is no "forgot password" link. Members who
are locked out ask an admin.

1. **Make sure it's really them.** Call them back on the number in their
   profile, or check with them in person.
2. Open **Members**, search for them and tap their name. Tap **Reset password**,
   then **Reset password** again to confirm.
3. ShiftSwap shows a **temporary password** once, something like
   `Harbor-Maple-4821`. Tap **Copy**, or **Text it** to send it from your phone.
   It is not stored anywhere, so if you lose it, reset again.
4. They sign in with it and are asked to choose a new password straight away.

You can't reset your own password this way. Use **Change password** on your
Profile page, or ask another admin.

---

## 4. Editing, suspending and reactivating members

Open **Members** and tap a member to see their details and the **Manage**
buttons. The **Status** filter shows **Everyone**, **Active**, **Waiting for
approval**, **Suspended**, **Turned down**, **Still signing up** or **Removed**.

**Edit details:** fix their name, rank, station, tour, phone or employee ID,
then tap **Save changes**. The phone number needs an area code (at least 7
digits), the same rule as the member's own form. Members can change their own
phone, station and tour, but name, rank and employee ID are admin-only.

**Suspend:** tap **Suspend**, give a reason and confirm. The member can no
longer use ShiftSwap (they see the reason in an alert). When you suspend
someone:

- Their **upcoming open posts are taken down** and their **pending requests are
  closed**. Everyone affected is told.
- Their **confirmed trades stay**. If a trade shouldn't happen, void it in
  **Trades** (section 7).

**Reactivate:** open the member and tap **Reactivate** to let them back in.
Posts taken down when they were suspended don't come back.

---

## 5. Removing an account (when a member asks)

The privacy page promises members that an admin removes their account if they
ask. Suspending isn't enough, because it keeps their phone number and email.
**Remove member** is the tool for this.

1. **Make sure the request really comes from them**, for example by calling them
   back on the number in their profile.
2. Open **Members**, tap their name and tap **Remove member**.
3. The box explains what happens. Type a short reason (it's kept in the
   activity log), for example "Retired. Asked by text on Sep 23." Then tap
   **Remove member**.

What removal does:

- **Erased:** their phone number, email address and employee ID, their link to
  the roster (the roster entry is free for someone else), their alerts and alert
  subscriptions. Their calendar link stops working.
- **Closed:** they can't sign in anymore. Their open posts come down and their
  pending requests close, and the people affected are told.
- **Kept:** their name on the account and on past trades and messages, so other
  members' history and balances still add up.
- **Their confirmed trades that haven't happened yet stay.** The message after
  removing tells you how many. Void them in **Trades** if they won't happen.

Afterwards the account shows as **Removed** and leaves the normal member list.
Find it with **Status ▸ Removed**. A removal can't be undone in the app. If the
person comes back later, they create an account again with their email; it
starts as a new account.

You can't remove your own account or the last admin (make someone else an admin
first). If a message says **Their login needs another try**, open the member and
tap **Finish removal**. If that keeps failing, tell a developer (see
`HANDOFF.md`).

Don't delete members in the Supabase dashboard. It fails for anyone who ever
posted, requested or chatted, and it skips the clean-up above.

---

## 6. Making another admin

1. Open **Members**, find the person, and tap **Make admin**.
2. They get the shield icon and full admin access the next time a page loads.

To take admin away, tap **Remove admin**. ShiftSwap always keeps at least one
admin, so you can't remove the last one. Make someone else an admin first.

(The very first admin is created by a developer with a script. See
`docs/DEPLOY.md`.)

---

## 7. Taking down posts and voiding trades

Open **Trades** to see every post and trade. Use **Show** to pick **Confirmed,
upcoming** (the default), **Confirmed, already worked**, **Open posts**,
**Cancelled** or **Everything**, and narrow it down by **Member** name,
**From**/**To** dates, battalion or station. **Details** opens the trade's own
page. **Export CSV** saves everything that matches the filters (up to 5,000
rows) as a spreadsheet file.

- **Take down a post** (an open shift nobody has been confirmed for yet): tap
  **Take down post**, give a reason (the poster sees it) and confirm. The poster
  and anyone who asked for it are told.
- **Void a trade** (a confirmed trade): tap **Void trade**, give a reason (both
  members see it) and confirm. Both members are told. This works even after the
  shift has started (members can't undo a started trade themselves). For a
  SwapMatch, both days are undone together. If the shift hasn't started, it goes
  back on the board as an open post; if it has, it's marked cancelled.

ShiftSwap won't void a trade if undoing it would put someone on two shifts the
same day (for example, they picked up another shift on the day they would get
back). The message tells you. Sort out the other trade first.

Remember that voiding in ShiftSwap doesn't change TeleStaff. If the trade was
already entered there, it has to be fixed there too.

---

## 8. The activity log

**Activity** lists important events, newest first: sign-ups and roster matches,
approvals and rejections, suspensions, account removals, role changes, password
resets, roster uploads, posts, confirmed trades, cancellations and voids. Each
entry shows who did it and when. Use **Show** to see one kind of event, and the
refresh button to load the newest.

Use it to answer questions like "who approved this person?", "when was this
trade cancelled, and by whom?" or "why is this person pending?" (the roster note
explains what didn't match).

---

## 9. If ShiftSwap is down

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
**Alerts on this device** off and on again in their Profile. On iPhone, alerts
only work when ShiftSwap is installed on the home screen. If nobody gets alerts,
the push settings may be missing (see "Push alerts" in `docs/DEPLOY.md`). Alerts
always appear inside the app either way.
