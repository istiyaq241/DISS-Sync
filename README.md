# DISS Sync

DISS Sync is an Expo + Firebase routine and classroom operations app for DISS. It helps teachers see their own routine, lets senior teachers/admins manage schedules, and stores attendance, class notes, student tokens, and routine changes in Firebase.

The app is designed for Android, web, and iOS-compatible Expo builds. It uses Firebase Authentication, Cloud Firestore, Expo Updates, and Expo Print.

## Main Features

### Login and Accounts

- Email/password login through Firebase Authentication.
- Viewer login for read-only routine lookup.
- Forgot password flow from the login screen.
- Native login persistence on phone builds, so users should stay signed in after closing the app.
- Role-based app sections after login.

### Roles

| Role | App access |
| --- | --- |
| Admin | All routine views, Class Edit, Routine Builder, upload routine |
| Senior | All routine views, Class Edit, Routine Builder |
| Teacher | My Routine and Class Edit for their own classes |
| Volunteer | My Routine and Class Edit for their own classes |
| Caregiver | My Routine and Class Edit for their own classes |
| Viewer | My Routine, Teachers, Students, Classes, Rooms |

Teacher-like roles are: `teacher`, `senior`, `volunteer`, and `caregiver`.

### My Routine

- Shows the signed-in teacher's own routine automatically when the user has a teaching role.
- Admin/viewer can manually choose or change the teacher shown.
- Lets users move between available routine days.
- Uses saved routine data from Firebase, with local cache fallback if Firebase is unavailable.

### Teacher Lookup

- Search for another teacher by name.
- View matching schedule entries sorted by day/time.
- Available to viewer, senior, and admin style users.

### Student View

- Choose a class.
- See that class routine for the current day.

### Class View

- Choose a class.
- See the full routine for that class.

### Room View

- Choose a room.
- See all routine entries assigned to that room.

### Class Edit

Class Edit has four tabs:

- Schedule
- Attendance
- Class Notes
- Tokens

For teacher-like users, Class Edit is filtered to their own assigned classes where possible. Admin and senior users can manage wider schedule work.

### Schedule Editing and Teacher Assignment

- Admin and senior users can tap a schedule slot and assign/change:
  - teacher
  - class type
  - room
- Teacher options come from both the built-in teacher list and the current routine data.
- Teacher-like non-admin users can view their schedule work without seeing assignment controls.

### Attendance

- Teachers can check in and check out.
- Only one open check-in session is allowed at a time.
- Attendance records are saved in Firestore under the signed-in user's identity.
- Saved attendance includes:
  - `uid`
  - `employeeId`
  - `displayName`
  - `role`
  - `teacherName`
  - `date`
  - check-in/check-out sessions
- Attendance can be printed from the app.

### Class Notes

- Teachers select a class session, then the app focuses on that one note form.
- After selecting a class, the session list hides so the teacher can work on one class at a time.
- The teacher can tap `Change class` to pick another session.
- Notes include:
  - topics covered
  - homework/assignment
  - special notes
- Notes are saved in Firestore with the signed-in user's identity.
- Notes can be printed from the app.

### Student Tokens

- Choose a class and manage student token counts.
- Add student names to a class.
- Increase or decrease tokens for each student.
- Token records are saved in Firestore with the signed-in user's identity.
- Token reports can be printed from the app.

### Routine Builder

- Available to admin and senior users.
- Build or update the weekly routine by day and slot.
- Assign teacher, subject, room, class, and class type.
- Detects conflicts in the builder workflow.
- Saves routine records to Firestore.

### Routine Upload

- Admin users can upload an Excel or CSV routine from the app web experience.
- Upload can replace the current schedule collection and remove old records not present in the new file.
- Required upload columns:
  - `Teacher_ID`
  - `Teacher_Name`
  - `Class_No`
  - `Subject`
  - `Room_No`
  - `Date`
  - `Day`
  - `Start_Time`
  - `End_Time`
  - `Class_Type`

### Printing

- Schedule, attendance, class notes, and token reports use Expo Print.
- The app prints directly from HTML with `Print.printAsync({ html })`.
- This avoids the Android PDF sharing path that previously caused native errors.

### Updates

- Expo Updates are enabled.
- On production phone builds, the app checks for updates on launch.
- If an update is available, the user can choose to update now or later.
- Native changes, dependency changes, app config changes, and Firebase native persistence changes still require a new app build/install.

## How To Use The App

### Log In

1. Open the app.
2. Enter email and password.
3. Tap `Login`.
4. If the password is forgotten, type the email first and tap `Forgot password?`.
5. Check the email inbox and spam folder for the reset message.

### Continue As Viewer

1. Open the app.
2. Tap `Continue as Viewer`.
3. Use teacher, class, student, and room lookup views.

### See Your Own Routine

1. Log in as a teacher, senior, volunteer, or caregiver.
2. The app should automatically select your display name from your Firebase profile.
3. Open `My Routine`.
4. Use previous/next day controls to move between routine days.

If the wrong routine appears, check the user's `displayName` in Firestore. It must match the teacher name used in the schedule data.

### Check In and Check Out

1. Log in with a teaching role.
2. Open `Class Edit`.
3. Open the `Attendance` tab.
4. Tap `Check In` when starting work.
5. Tap `Check Out` when leaving.

The app prevents starting a second check-in until the open session is checked out.

### Save Class Notes

1. Open `Class Edit`.
2. Open `Class Notes`.
3. Choose the day.
4. Select one class session.
5. Fill in topics, homework, and special notes.
6. Tap `Save Notes`.
7. Use `Change class` only when you want to write notes for a different session.

### Manage Tokens

1. Open `Class Edit`.
2. Open `Tokens`.
3. Choose a class.
4. Add missing student names if needed.
5. Use plus/minus to change each student's token count.

### Assign A Teacher To A Slot

1. Log in as admin or senior.
2. Open `Class Edit`.
3. Open `Schedule`.
4. Tap a class slot.
5. Choose or search for a teacher.
6. Adjust class type or room if needed.
7. Tap `Save`.

### Build The Routine

1. Log in as admin or senior.
2. Open `Routine Builder`.
3. Choose the day.
4. Tap a slot.
5. Assign class details.
6. Save the routine.

### Upload A New Routine

1. Log in as admin.
2. Open `Class Edit`.
3. Use `Upload Excel / CSV`.
4. Confirm the upload.

This feature is intended for the web version of the app. Phone document picking is not currently implemented.

## Firebase Data

The app uses these Firestore collections:

| Collection | Purpose |
| --- | --- |
| `users` | Role, display name, employee ID, and profile details |
| `schedules` | Routine records |
| `attendance` | Check-in/check-out sessions |
| `classnotes` | Saved class notes |
| `tokens` | Student token counts by class/date |
| `students` | Student name lists by class |
| `logs` | App logs |
| `changes` | Change requests/history readable by senior/admin |

Important user profile fields:

```json
{
  "displayName": "Teacher Name",
  "employeeId": "EMP001",
  "role": "teacher"
}
```

Supported roles:

```text
admin
senior
teacher
volunteer
caregiver
viewer
student
```

## Firestore Rules

The included `firestore.rules` file allows:

- signed-in users to read schedules
- admin and senior users to create/update schedules
- admin users to delete schedules
- teacher-like users to create/update attendance, class notes, and tokens
- senior/admin users to read changes
- users to read their own profile, while admin can manage users

Deploy rules with:

```bash
firebase deploy --only firestore:rules
```

## Routine File Format

Excel/CSV routine files should contain:

```text
Teacher_ID
Teacher_Name
Class_No
Subject
Room_No
Date
Day
Start_Time
End_Time
Class_Type
```

Optional columns:

```text
ID
Modified_By
Timestamp
```

Time should look like:

```text
9:30 AM
02:15 PM
```

Day should be a weekday name:

```text
Sunday
Monday
Tuesday
Wednesday
Thursday
Friday
Saturday
```

## Developer Setup

Install dependencies:

```bash
npm install
```

Start Expo:

```bash
npm start
```

Start web:

```bash
npm run web
```

Export web:

```bash
npm run build:web
```

Check routine upload data without changing Firebase:

```bash
npm run routine:check
```

Convert Excel/CSV to JSON:

```bash
npm run routine:json -- routine.xlsx data.json
```

Upload routine JSON to Firestore:

```bash
npm run routine:upload -- --data=data.json
```

Replace Firestore schedules with the uploaded file and remove missing old records:

```bash
npm run routine:upload -- --data=data.json --replace
```

The upload script needs admin credentials through either:

- `scripts/firebase_admin_config.local.json`
- `DISS_FIREBASE_EMAIL` and `DISS_FIREBASE_PASSWORD`

## Building

Preview Android APK:

```bash
npx eas-cli build -p android --profile preview
```

Production Android app bundle:

```bash
npx eas-cli build -p android --profile production
```

The configured EAS channels are:

- `preview`
- `production`

## Updating Existing Users

Expo Updates can deliver JavaScript and asset updates to installed production builds.

Use a new native build when changing:

- native dependencies
- Firebase native persistence setup
- app icon/splash/native config
- Android package settings
- Expo SDK or React Native versions
- anything that requires native code changes

Use an over-the-air update for normal JavaScript, UI, and style fixes after a compatible native build is already installed.

## Current Limitations

- The app fetches routine data from Firebase on load and after saves, but not every screen uses continuous live listeners.
- Phone-side Excel upload uses a web file picker only; native document picker support is not implemented yet.
- Admin user creation/staff management is not currently present as a separate screen in this workspace.
- Android local export may fail if Windows blocks the Hermes compiler executable. That is a local permission/antivirus issue, not necessarily an app code issue.

## Troubleshooting

### A teacher sees the wrong routine

Check the user's Firestore `displayName`. It should match the `Teacher_Name` values in schedule records.

### A user sees too many or too few sections

Check the user's Firestore `role`. The app sections are role-based.

### Forgot password email does not arrive

Check that the email is registered in Firebase Authentication, then check spam/junk folders.

### Notes, attendance, or tokens fail to save

Check:

- the user is signed in
- the user has a teacher-like role
- Firestore rules are deployed
- the device has internet access

### Updates do not appear

Expo Updates run only in production phone builds, not in web or Expo Go development mode.

## Important Files

| File | Purpose |
| --- | --- |
| `App.js` | Login, navigation, routine views, upload, role filtering |
| `ClassEdit.js` | Schedule editing, attendance, notes, tokens, printing |
| `RoutineBuilder.js` | Weekly routine builder |
| `firebaseConfig.js` | Web Firebase config |
| `firebaseConfig.native.js` | Native Firebase config with persistent auth |
| `useAppUpdates.js` | Expo update check on production phone builds |
| `firestore.rules` | Firestore security rules |
| `scripts/excel_to_json.py` | Convert routine Excel/CSV to JSON |
| `scripts/upload_to_firestore.js` | Upload routine JSON to Firestore |
| `app.json` | Expo app configuration |
| `eas.json` | EAS build profiles |

