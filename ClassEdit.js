import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  addDoc,
  collection,
  doc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import * as Print from 'expo-print';
import { db } from './firebaseConfig';

// ─── Constants ────────────────────────────────────────────────────────────────

const DAY_ORDER = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const TEACHERS = [
  'Abdullah', 'Ashraful', 'Fahim', 'Farhana', 'Goutam',
  'Ishtiaque', 'Nazrul', 'Principal', 'Rafi', 'Riaz',
  'Sadia', 'Shimanto', 'Sumayera',
];

const CLASS_TYPES = ['Regular', 'Proxy', 'Makeup', 'Exam', 'Extra', 'Cancelled'];
const TEACHER_LIKE_ROLES = ['teacher', 'senior', 'volunteer', 'caregiver'];

const TABS = [
  { key: 'Schedule', icon: '📅' },
  { key: 'Attendance', icon: '✅' },
  { key: 'Class Notes', icon: '📝' },
  { key: 'Tokens', icon: '🏅' },
];

const TYPE_COLORS = {
  Regular:   { bg: '#e8f5e9', text: '#2e7d32', border: '#a5d6a7' },
  Proxy:     { bg: '#fff3e0', text: '#e65100', border: '#ffcc80' },
  Makeup:    { bg: '#e3f2fd', text: '#1565c0', border: '#90caf9' },
  Exam:      { bg: '#fce4ec', text: '#880e4f', border: '#f48fb1' },
  Extra:     { bg: '#ede7f6', text: '#4527a0', border: '#ce93d8' },
  Cancelled: { bg: '#f5f5f5', text: '#757575', border: '#bdbdbd' },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const getDateRange = () => {
  const result = [];
  for (let i = 0; i <= 3; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const dayName = DAY_ORDER[d.getDay()];
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    result.push({
      label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : `+${i} days`,
      dayName,
      dateStr: `${dd}/${mm}/${yyyy}`,
    });
  }
  return result;
};

const nowTime = () => {
  const d = new Date();
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
};

const typeColors = (type) => TYPE_COLORS[type] || TYPE_COLORS.Regular;
const normalizeRole = (role) => String(role || 'viewer').trim().toLowerCase();
const isTeacherLikeRole = (role) => TEACHER_LIKE_ROLES.includes(normalizeRole(role));
const sameText = (left, right) => String(left || '').trim().toLowerCase() === String(right || '').trim().toLowerCase();

// ─── PDF helpers ──────────────────────────────────────────────────────────────

const printHtml = async (html) => {
  try {
    await Print.printAsync({ html });
  } catch (err) {
    Alert.alert('Print failed', err.message);
  }
};

const wrapHtml = (title, bodyHtml) => `
<!DOCTYPE html><html><head><meta charset="utf-8"/>
<style>
  body { font-family: Arial, sans-serif; padding: 24px; color: #1f2d3d; }
  h1 { color: #174ea6; margin-bottom: 4px; }
  .sub { color: #667789; font-size: 13px; margin-bottom: 20px; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  th { background: #174ea6; color: #fff; padding: 8px 10px; text-align: left; font-size: 13px; }
  td { padding: 8px 10px; border-bottom: 1px solid #e0e7f0; font-size: 13px; }
  tr:nth-child(even) td { background: #f7f9fc; }
  .section { margin-top: 20px; font-weight: bold; font-size: 15px; color: #174ea6; border-bottom: 2px solid #174ea6; padding-bottom: 4px; }
  .note-block { background: #f7f9fc; border-radius: 6px; padding: 10px; margin-top: 8px; }
  .note-label { font-size: 11px; font-weight: bold; color: #667789; text-transform: uppercase; margin-bottom: 4px; }
  .note-value { font-size: 13px; color: #1f2d3d; }
</style>
</head><body><h1>${title}</h1>${bodyHtml}</body></html>`;

// ─── Component ────────────────────────────────────────────────────────────────

export default function ClassEdit({ currentUser, schedules, onSaved, theme }) {
  const [activeTab, setActiveTab] = useState('Schedule');
  const [dateRange] = useState(getDateRange);

  // ── Schedule tab ─────────────────────────────────────────────────────────────
  const [selectedDateIdx, setSelectedDateIdx] = useState(0);
  const [editingSlot, setEditingSlot] = useState(null);
  const [slotDraft, setSlotDraft] = useState({});
  const [savingSlot, setSavingSlot] = useState(false);
  const [teacherSearch, setTeacherSearch] = useState('');

  // ── Attendance tab ────────────────────────────────────────────────────────────
  const [attendTeacher, setAttendTeacher] = useState('');
  const [sessions, setSessions] = useState([]);
  const [loadingAttend, setLoadingAttend] = useState(false);
  const [savingAttend, setSavingAttend] = useState(false);

  // ── Class Notes tab ───────────────────────────────────────────────────────────
  const [notesDateIdx, setNotesDateIdx] = useState(0);
  const [notesSlot, setNotesSlot] = useState(null);
  const [noteDraft, setNoteDraft] = useState({ topics: '', hw: '', special: '' });
  const [savingNote, setSavingNote] = useState(false);

  // ── Tokens tab ────────────────────────────────────────────────────────────────
  const [tokensClass, setTokensClass] = useState('');
  const [students, setStudents] = useState([]);
  const [tokenData, setTokenData] = useState({});
  const [newStudentName, setNewStudentName] = useState('');
  const [loadingTokens, setLoadingTokens] = useState(false);

  // Derived
  const selectedDate = dateRange[selectedDateIdx];
  const notesDate = dateRange[notesDateIdx];
  const actor = {
    uid: currentUser?.uid || '',
    employeeId: currentUser?.employeeId || '',
    displayName: currentUser?.displayName || 'Unknown user',
    role: normalizeRole(currentUser?.role),
  };
  const actorMeta = {
    uid: actor.uid,
    employeeId: actor.employeeId,
    displayName: actor.displayName,
    role: actor.role,
  };
  const isTeacherLikeUser = isTeacherLikeRole(actor.role);
  const canAssignTeacher = actor.role === 'admin' || actor.role === 'senior';
  const canEditSchedule = canAssignTeacher;
  const s = useMemo(() => createClassEditStyles(theme), [theme]);

  const daySchedule = schedules
    .filter((s) => s.day === selectedDate.dayName)
    .filter((s) => !isTeacherLikeUser || sameText(s.teacherName, actor.displayName))
    .sort((a, b) => a.startSort - b.startSort);

  const notesDaySchedule = schedules
    .filter((s) => s.day === notesDate.dayName)
    .filter((s) => !isTeacherLikeUser || sameText(s.teacherName, actor.displayName))
    .sort((a, b) => a.startSort - b.startSort);

  const classNos = [...new Set(
    schedules
      .filter((slot) => !isTeacherLikeUser || sameText(slot.teacherName, actor.displayName))
      .map((s) => s.classNo),
  )].sort((a, b) => {
    if (a === 'Pre-Class') return -1;
    if (b === 'Pre-Class') return 1;
    return a.localeCompare(b, undefined, { numeric: true });
  });

  const teacherOptions = [...new Set([...TEACHERS, ...schedules.map((slot) => slot.teacherName).filter(Boolean)])]
    .sort((a, b) => a.localeCompare(b));

  const filteredTeachers = teacherOptions.filter(
    (t) => !teacherSearch || t.toLowerCase().includes(teacherSearch.toLowerCase()),
  );

  // ── Schedule: open edit modal ─────────────────────────────────────────────────

  const openSlotEdit = (slot) => {
    setSlotDraft({
      teacherName: slot.teacherName,
      subject: slot.subject,
      roomNo: slot.roomNo,
      classType: slot.classType,
    });
    setTeacherSearch('');
    setEditingSlot(slot);
  };

  const saveSlotEdit = async () => {
    if (!slotDraft.teacherName || !slotDraft.subject || !slotDraft.roomNo) {
      Alert.alert('Missing info', 'Teacher, subject, and room are required.');
      return;
    }
    setSavingSlot(true);
    try {
      const [startTime, endTime = ''] = editingSlot.time.split(' - ');
      await setDoc(doc(db, 'schedules', editingSlot.id), {
        Teacher_Name: slotDraft.teacherName,
        Teacher_ID: editingSlot.teacherId || '',
        Subject: slotDraft.subject,
        Room_No: slotDraft.roomNo,
        Class_No: editingSlot.classNo === 'Pre-Class' ? '0' : editingSlot.classNo,
        Day: editingSlot.day,
        Date: selectedDate.dateStr,
        Start_Time: startTime,
        End_Time: endTime,
        Class_Type: slotDraft.classType,
        Modified_By: 'ClassEdit',
      });
      setEditingSlot(null);
      onSaved?.();
    } catch (err) {
      Alert.alert('Save failed', err.message);
    } finally {
      setSavingSlot(false);
    }
  };

  const exportSchedule = async () => {
    const rows = daySchedule.map(
      (s) => `<tr>
        <td>${s.time}</td>
        <td>${s.subject}</td>
        <td>Class ${s.classNo}</td>
        <td>${s.teacherName}</td>
        <td>Rm ${s.roomNo}</td>
        <td>${s.classType}</td>
      </tr>`,
    ).join('');
    const html = wrapHtml(
      `Schedule — ${selectedDate.dayName} ${selectedDate.dateStr}`,
      `<table>
        <tr><th>Time</th><th>Subject</th><th>Class</th><th>Teacher</th><th>Room</th><th>Type</th></tr>
        ${rows}
      </table>`,
    );
    await printHtml(html, `Schedule_${selectedDate.dayName}`);
  };

  // ── Attendance ────────────────────────────────────────────────────────────────

  const loadAttendance = useCallback(async (teacher) => {
    if (!teacher) return;
    setLoadingAttend(true);
    try {
      const filters = [
        where('teacherName', '==', teacher),
        where('date', '==', dateRange[0].dateStr),
      ];

      if (isTeacherLikeUser && actor.role !== 'senior' && actor.uid) {
        filters.push(where('uid', '==', actor.uid));
      }

      const q = query(collection(db, 'attendance'), ...filters);
      const snap = await getDocs(q);
      setSessions(snap.empty ? [] : snap.docs[0].data().sessions || []);
    } catch { /* silent */ }
    finally { setLoadingAttend(false); }
  }, [actor.role, actor.uid, dateRange, isTeacherLikeUser]);

  useEffect(() => {
    if (activeTab === 'Attendance' && attendTeacher) loadAttendance(attendTeacher);
  }, [activeTab, attendTeacher, loadAttendance]);

  useEffect(() => {
    if (isTeacherLikeUser && actor.displayName && attendTeacher !== actor.displayName) {
      setAttendTeacher(actor.displayName);
    }
  }, [actor.displayName, attendTeacher, isTeacherLikeUser]);

  const saveSessionsToFirestore = async (updated) => {
    setSavingAttend(true);
    try {
      const todayStr = dateRange[0].dateStr;
      const filters = [
        where('teacherName', '==', attendTeacher),
        where('date', '==', todayStr),
      ];

      if (isTeacherLikeUser && actor.role !== 'senior' && actor.uid) {
        filters.push(where('uid', '==', actor.uid));
      }

      const q = query(collection(db, 'attendance'), ...filters);
      const snap = await getDocs(q);
      const record = {
        teacherName: attendTeacher,
        date: todayStr,
        sessions: updated,
        updatedAt: new Date().toISOString(),
        ...actorMeta,
      };
      if (!snap.empty) {
        await updateDoc(doc(db, 'attendance', snap.docs[0].id), record);
      } else {
        await addDoc(collection(db, 'attendance'), record);
      }
      setSessions(updated);
    } catch (err) { Alert.alert('Failed', err.message); }
    finally { setSavingAttend(false); }
  };

  const handleCheckIn = () => {
    if (sessions.some((s) => !s.checkOut)) {
      Alert.alert('Already checked in', 'Please check out before checking in again.');
      return;
    }
    saveSessionsToFirestore([...sessions, { checkIn: nowTime(), checkOut: null }]);
  };

  const handleCheckOut = () => {
    const idx = sessions.findIndex((s) => !s.checkOut);
    if (idx === -1) { Alert.alert('Not checked in', 'Check in first.'); return; }
    const updated = [...sessions];
    updated[idx] = { ...updated[idx], checkOut: nowTime() };
    saveSessionsToFirestore(updated);
  };

  const exportAttendancePdf = async () => {
    const rows = sessions.map((s, i) => `
      <tr>
        <td>Session ${i + 1}</td>
        <td>${s.checkIn}</td>
        <td>${s.checkOut || '<em>Open</em>'}</td>
      </tr>`).join('');
    const html = wrapHtml(
      `Attendance — ${attendTeacher}`,
      `<div class="sub">${dateRange[0].dateStr}</div>
      <table>
        <tr><th>#</th><th>Check In</th><th>Check Out</th></tr>
        ${rows}
      </table>
      <p style="margin-top:16px;">Total sessions: <strong>${sessions.length}</strong></p>`,
    );
    await printHtml(html, `Attendance_${attendTeacher}`);
  };

  // ── Class Notes ───────────────────────────────────────────────────────────────

  const loadNote = useCallback(async (slot, dateStr) => {
    if (!slot) return;
    try {
      const filters = [
        where('scheduleId', '==', slot.id),
        where('date', '==', dateStr),
      ];

      if (isTeacherLikeUser && actor.role !== 'senior' && actor.uid) {
        filters.push(where('uid', '==', actor.uid));
      }

      const q = query(collection(db, 'classnotes'), ...filters);
      const snap = await getDocs(q);
      setNoteDraft(snap.empty
        ? { topics: '', hw: '', special: '' }
        : { topics: snap.docs[0].data().topics || '', hw: snap.docs[0].data().hw || '', special: snap.docs[0].data().special || '' });
    } catch { /* silent */ }
  }, [actor.role, actor.uid, isTeacherLikeUser]);

  useEffect(() => {
    if (notesSlot) loadNote(notesSlot, notesDate.dateStr);
  }, [notesSlot, notesDate.dateStr, loadNote]);

  // Reset notesSlot when day changes
  useEffect(() => { setNotesSlot(null); }, [notesDateIdx]);

  const saveNote = async () => {
    if (!notesSlot) return;
    setSavingNote(true);
    try {
      const filters = [
        where('scheduleId', '==', notesSlot.id),
        where('date', '==', notesDate.dateStr),
      ];

      if (isTeacherLikeUser && actor.role !== 'senior' && actor.uid) {
        filters.push(where('uid', '==', actor.uid));
      }

      const q = query(collection(db, 'classnotes'), ...filters);
      const snap = await getDocs(q);
      const record = {
        scheduleId: notesSlot.id,
        teacherName: notesSlot.teacherName,
        classNo: notesSlot.classNo,
        subject: notesSlot.subject,
        day: notesSlot.day,
        date: notesDate.dateStr,
        time: notesSlot.time,
        topics: noteDraft.topics,
        hw: noteDraft.hw,
        special: noteDraft.special,
        savedAt: new Date().toISOString(),
        ...actorMeta,
      };
      if (!snap.empty) {
        await updateDoc(doc(db, 'classnotes', snap.docs[0].id), record);
      } else {
        await addDoc(collection(db, 'classnotes'), record);
      }
      Alert.alert('Saved ✓', 'Class notes saved to Firebase.');
    } catch (err) { Alert.alert('Failed', err.message); }
    finally { setSavingNote(false); }
  };

  const exportNotePdf = async () => {
    const html = wrapHtml(
      `Class Note — ${notesSlot.subject}`,
      `<div class="sub">${notesSlot.teacherName} · Class ${notesSlot.classNo} · ${notesDate.dateStr} · ${notesSlot.time}</div>
      <div class="section">Topics Covered</div>
      <div class="note-block"><div class="note-value">${noteDraft.topics || '—'}</div></div>
      <div class="section">Homework Given</div>
      <div class="note-block"><div class="note-value">${noteDraft.hw || '—'}</div></div>
      <div class="section">Special Notes</div>
      <div class="note-block"><div class="note-value">${noteDraft.special || '—'}</div></div>`,
    );
    await printHtml(html, `ClassNote_${notesSlot.subject}`);
  };

  // ── Tokens ────────────────────────────────────────────────────────────────────

  const loadStudentsAndTokens = useCallback(async (classNo) => {
    setLoadingTokens(true);
    try {
      const sq = query(collection(db, 'students'), where('classNo', '==', classNo));
      const ssnap = await getDocs(sq);
      const names = ssnap.empty ? [] : ssnap.docs[0].data().names || [];
      setStudents(names);

      const tq = query(
        collection(db, 'tokens'),
        where('classNo', '==', classNo),
        where('date', '==', dateRange[0].dateStr),
      );
      const tsnap = await getDocs(tq);
      const map = {};
      tsnap.docs.forEach((d) => {
        const data = d.data();
        map[data.studentName] = { tokens: data.tokens, docId: d.id };
      });
      setTokenData(map);
    } catch { /* silent */ }
    finally { setLoadingTokens(false); }
  }, [dateRange]);

  useEffect(() => {
    if (activeTab === 'Tokens' && tokensClass) loadStudentsAndTokens(tokensClass);
  }, [activeTab, tokensClass, loadStudentsAndTokens]);

  const adjustToken = async (studentName, delta) => {
    const current = tokenData[studentName]?.tokens || 0;
    const next = Math.max(0, current + delta);
    const dateStr = dateRange[0].dateStr;
    try {
      if (tokenData[studentName]?.docId) {
        await updateDoc(doc(db, 'tokens', tokenData[studentName].docId), {
          tokens: next,
          updatedAt: new Date().toISOString(),
          ...actorMeta,
        });
        setTokenData((prev) => ({ ...prev, [studentName]: { ...prev[studentName], tokens: next } }));
      } else {
        const newRef = await addDoc(collection(db, 'tokens'), {
          classNo: tokensClass,
          studentName,
          date: dateStr,
          tokens: next,
          updatedAt: new Date().toISOString(),
          ...actorMeta,
        });
        setTokenData((prev) => ({ ...prev, [studentName]: { tokens: next, docId: newRef.id } }));
      }
    } catch (err) { Alert.alert('Failed', err.message); }
  };

  const addStudent = async () => {
    const name = newStudentName.trim();
    if (!name) return;
    if (students.includes(name)) { Alert.alert('Exists', `${name} is already in the list.`); return; }
    const updated = [...students, name].sort();
    try {
      const q = query(collection(db, 'students'), where('classNo', '==', tokensClass));
      const snap = await getDocs(q);
      if (!snap.empty) {
        await updateDoc(doc(db, 'students', snap.docs[0].id), { names: updated });
      } else {
        await addDoc(collection(db, 'students'), { classNo: tokensClass, names: updated });
      }
      setStudents(updated);
      setNewStudentName('');
    } catch (err) { Alert.alert('Failed', err.message); }
  };

  const exportTokensPdf = async () => {
    const rows = students.map((name) => {
      const t = tokenData[name]?.tokens || 0;
      return `<tr><td>${name}</td><td style="text-align:center;font-weight:bold;">${t}</td></tr>`;
    }).join('');
    const html = wrapHtml(
      `Token Report — Class ${tokensClass}`,
      `<div class="sub">${dateRange[0].dateStr}</div>
      <table><tr><th>Student</th><th>Tokens</th></tr>${rows}</table>`,
    );
    await printHtml(html, `Tokens_Class${tokensClass}`);
  };

  // ─── Render tabs ─────────────────────────────────────────────────────────────

  const renderScheduleTab = () => (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipRow}>
        {dateRange.map((d, i) => (
          <TouchableOpacity
            key={i}
            onPress={() => setSelectedDateIdx(i)}
            style={[s.dateChip, selectedDateIdx === i && s.dateChipActive]}
          >
            <Text style={[s.dateChipLabel, selectedDateIdx === i && s.dateChipLabelActive]}>{d.label}</Text>
            <Text style={[s.dateChipSub, selectedDateIdx === i && s.dateChipSubActive]}>{d.dayName}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <View style={s.sectionRow}>
        <Text style={s.sectionCount}>{daySchedule.length} class{daySchedule.length !== 1 ? 'es' : ''} · {selectedDate.dayName}</Text>
        {daySchedule.length > 0 && (
          <TouchableOpacity onPress={exportSchedule} style={s.exportMini}>
            <Text style={s.exportMiniText}>Export PDF</Text>
          </TouchableOpacity>
        )}
      </View>

      {daySchedule.length === 0 && <Text style={s.emptyMsg}>No classes scheduled for {selectedDate.dayName}.</Text>}

      {daySchedule.map((slot) => {
        const tc = typeColors(slot.classType);
        return (
          <TouchableOpacity
            key={slot.id}
            disabled={!canEditSchedule}
            onPress={() => openSlotEdit(slot)}
            style={s.slotCard}
          >
            <View style={s.slotCardRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.slotSubject}>{slot.subject}</Text>
                <Text style={s.slotMeta}>{slot.time}  ·  Room {slot.roomNo}  ·  Class {slot.classNo}</Text>
                <Text style={s.slotTeacher}>{slot.teacherName}</Text>
              </View>
              <View>
                <View style={[s.typeBadge, { backgroundColor: tc.bg, borderColor: tc.border }]}>
                  <Text style={[s.typeBadgeText, { color: tc.text }]}>{slot.classType}</Text>
                </View>
                {canEditSchedule && <Text style={s.editHint}>Assign</Text>}
              </View>
            </View>
          </TouchableOpacity>
        );
      })}

      {/* Edit Modal */}
      {!!editingSlot && (
        <Modal visible animationType="slide" transparent>
          <View style={s.overlay}>
            <View style={s.modal}>
              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                <Text style={s.modalTitle}>Edit Class</Text>
                <Text style={s.modalSub}>{editingSlot.subject}  ·  Class {editingSlot.classNo}  ·  {editingSlot.time}</Text>

                <Text style={s.fieldLabel}>Teacher</Text>
                <TextInput
                  style={s.searchBox}
                  value={teacherSearch}
                  onChangeText={setTeacherSearch}
                  placeholder={slotDraft.teacherName || 'Search teacher…'}
                  placeholderTextColor={slotDraft.teacherName ? (theme?.text || '#1f2d3d') : (theme?.placeholder || '#9aaabb')}
                />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipRow}>
                  {filteredTeachers.map((t) => (
                    <TouchableOpacity
                      key={t}
                      onPress={() => { setSlotDraft((d) => ({ ...d, teacherName: t })); setTeacherSearch(''); }}
                      style={[s.chip, slotDraft.teacherName === t && s.chipOn]}
                    >
                      <Text style={[s.chipText, slotDraft.teacherName === t && s.chipTextOn]}>{t}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                <Text style={s.fieldLabel}>Class Type</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipRow}>
                  {CLASS_TYPES.map((ct) => {
                    const tc = typeColors(ct);
                    const on = slotDraft.classType === ct;
                    return (
                      <TouchableOpacity
                        key={ct}
                        onPress={() => setSlotDraft((d) => ({ ...d, classType: ct }))}
                        style={[s.chip, on && { backgroundColor: tc.bg, borderColor: tc.border, borderWidth: 1.5 }]}
                      >
                        <Text style={[s.chipText, on && { color: tc.text, fontWeight: '800' }]}>{ct}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>

                <Text style={s.fieldLabel}>Room</Text>
                <TextInput
                  style={s.textInput}
                  value={slotDraft.roomNo}
                  onChangeText={(v) => setSlotDraft((d) => ({ ...d, roomNo: v }))}
                  placeholder="Room number"
                  placeholderTextColor={theme?.placeholder || '#9aaabb'}
                  keyboardType="numeric"
                />

                <View style={s.modalFooter}>
                  <TouchableOpacity onPress={() => setEditingSlot(null)} style={s.btnCancel}>
                    <Text style={s.btnCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={saveSlotEdit} style={s.btnSave} disabled={savingSlot}>
                    {savingSlot ? <ActivityIndicator color="#fff" /> : <Text style={s.btnSaveText}>Save</Text>}
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );

  const renderAttendanceTab = () => {
    const hasOpen = sessions.some((ss) => !ss.checkOut);
    return (
      <View>
        <Text style={s.fieldLabel}>Teacher</Text>
        {isTeacherLikeUser ? (
          <View style={[s.chip, s.chipOn, { alignSelf: 'flex-start', marginTop: 8 }]}>
            <Text style={[s.chipText, s.chipTextOn]}>{actor.displayName}</Text>
          </View>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipRow}>
            {TEACHERS.map((t) => (
              <TouchableOpacity
                key={t}
                onPress={() => setAttendTeacher(t)}
                style={[s.chip, attendTeacher === t && s.chipOn]}
              >
                <Text style={[s.chipText, attendTeacher === t && s.chipTextOn]}>{t}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {!!attendTeacher && (
          <View>
            <View style={s.attendActions}>
              <TouchableOpacity
                onPress={handleCheckIn}
                disabled={savingAttend || hasOpen}
                style={[s.attendBtn, s.attendBtnIn, (savingAttend || hasOpen) && s.attendBtnDim]}
              >
                <Text style={s.attendBtnText}>✓  Check In</Text>
                <Text style={s.attendBtnSub}>{nowTime()}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleCheckOut}
                disabled={savingAttend || !hasOpen}
                style={[s.attendBtn, s.attendBtnOut, (savingAttend || !hasOpen) && s.attendBtnDim]}
              >
                <Text style={s.attendBtnText}>✗  Check Out</Text>
                <Text style={s.attendBtnSub}>{nowTime()}</Text>
              </TouchableOpacity>
            </View>

            {loadingAttend && <ActivityIndicator style={{ marginTop: 20 }} color="#174ea6" />}

            {!loadingAttend && sessions.length > 0 && (
              <View style={s.sessionLog}>
                <View style={s.sectionRow}>
                  <Text style={s.sessionLogTitle}>Today's Sessions — {attendTeacher}</Text>
                  <TouchableOpacity onPress={exportAttendancePdf} style={s.exportMini}>
                    <Text style={s.exportMiniText}>PDF</Text>
                  </TouchableOpacity>
                </View>
                {sessions.map((ss, i) => (
                  <View key={i} style={s.sessionRow}>
                    <View style={[s.sessionDot, !ss.checkOut && s.sessionDotOpen]} />
                    <View style={{ flex: 1 }}>
                      <Text style={s.sessionLabel}>Session {i + 1}</Text>
                      <Text style={s.sessionTime}>In: {ss.checkIn}   {ss.checkOut ? `Out: ${ss.checkOut}` : '(still present)'}</Text>
                    </View>
                    {!ss.checkOut && <View style={s.activePill}><Text style={s.activePillText}>ACTIVE</Text></View>}
                  </View>
                ))}
              </View>
            )}

            {!loadingAttend && sessions.length === 0 && (
              <View style={s.emptyCard}>
                <Text style={s.emptyCardText}>No sessions recorded today for {attendTeacher}.</Text>
                <Text style={s.emptyCardSub}>Tap Check In to start the first session.</Text>
              </View>
            )}
          </View>
        )}
      </View>
    );
  };

  const renderClassNotesTab = () => (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipRow}>
        {dateRange.map((d, i) => (
          <TouchableOpacity
            key={i}
            onPress={() => setNotesDateIdx(i)}
            style={[s.dateChip, notesDateIdx === i && s.dateChipActive]}
          >
            <Text style={[s.dateChipLabel, notesDateIdx === i && s.dateChipLabelActive]}>{d.label}</Text>
            <Text style={[s.dateChipSub, notesDateIdx === i && s.dateChipSubActive]}>{d.dayName}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {!notesSlot && (
        <View>
      <Text style={s.fieldLabel}>Select Class Session</Text>
      {notesDaySchedule.length === 0 && <Text style={s.emptyMsg}>No classes on {notesDate.dayName}.</Text>}
      {notesDaySchedule.map((slot) => (
        <TouchableOpacity
          key={slot.id}
          onPress={() => setNotesSlot(slot)}
          style={[s.slotCard, notesSlot?.id === slot.id && s.slotCardSelected]}
        >
          <View style={s.slotCardRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.slotSubject}>{slot.subject}</Text>
              <Text style={s.slotMeta}>{slot.time}  ·  Class {slot.classNo}  ·  {slot.teacherName}</Text>
            </View>
            {notesSlot?.id === slot.id && <Text style={s.selectedTick}>✓</Text>}
          </View>
        </TouchableOpacity>
      ))}
        </View>
      )}

      {!!notesSlot && (
        <View style={s.notesForm}>
          <Text style={s.notesFormTitle}>
            {notesSlot.subject} — Class {notesSlot.classNo}
          </Text>
          <Text style={s.notesFormSub}>{notesSlot.teacherName}  ·  {notesDate.dateStr}</Text>

          <TouchableOpacity onPress={() => setNotesSlot(null)} style={s.changeMini}>
            <Text style={s.changeMiniText}>Change class</Text>
          </TouchableOpacity>

          <Text style={s.fieldLabel}>Topics Covered</Text>
          <TextInput
            style={[s.textInput, s.textArea]}
            value={noteDraft.topics}
            onChangeText={(v) => setNoteDraft((d) => ({ ...d, topics: v }))}
            placeholder="What was taught in this class…"
            multiline
            numberOfLines={3}
          />

          <Text style={s.fieldLabel}>Homework / Assignment Given</Text>
          <TextInput
            style={[s.textInput, s.textArea]}
            value={noteDraft.hw}
            onChangeText={(v) => setNoteDraft((d) => ({ ...d, hw: v }))}
            placeholder="Homework or assignment details…"
            multiline
            numberOfLines={2}
          />

          <Text style={s.fieldLabel}>Special Notes</Text>
          <TextInput
            style={[s.textInput, s.textArea]}
            value={noteDraft.special}
            onChangeText={(v) => setNoteDraft((d) => ({ ...d, special: v }))}
            placeholder="Observations, incidents, honorarium notes…"
            multiline
            numberOfLines={2}
          />

          <View style={s.notesBtns}>
            <TouchableOpacity onPress={saveNote} style={[s.btnSave, { flex: 1 }]} disabled={savingNote}>
              {savingNote ? <ActivityIndicator color="#fff" /> : <Text style={s.btnSaveText}>Save Notes</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={exportNotePdf} style={s.exportFull}>
              <Text style={s.exportFullText}>Export PDF</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );

  const renderTokensTab = () => (
    <View>
      <Text style={s.fieldLabel}>Class</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipRow}>
        {classNos.map((c) => (
          <TouchableOpacity
            key={c}
            onPress={() => setTokensClass(c)}
            style={[s.chip, tokensClass === c && s.chipOn]}
          >
            <Text style={[s.chipText, tokensClass === c && s.chipTextOn]}>
              {c === 'Pre-Class' ? 'Pre-Class' : `Class ${c}`}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {!!tokensClass && (
        <View>
          {loadingTokens && <ActivityIndicator style={{ marginTop: 20 }} color="#174ea6" />}

          {!loadingTokens && (
            <View>
              <View style={s.sectionRow}>
                <Text style={s.sectionCount}>{students.length} student{students.length !== 1 ? 's' : ''}  ·  Class {tokensClass}</Text>
                {students.length > 0 && (
                  <TouchableOpacity onPress={exportTokensPdf} style={s.exportMini}>
                    <Text style={s.exportMiniText}>Export PDF</Text>
                  </TouchableOpacity>
                )}
              </View>

              {students.length === 0 && (
                <Text style={s.emptyMsg}>No students yet. Add names below.</Text>
              )}

              {students.map((name) => {
                const t = tokenData[name]?.tokens || 0;
                return (
                  <View key={name} style={s.studentRow}>
                    <Text style={s.studentName}>{name}</Text>
                    <View style={s.tokenControls}>
                      <TouchableOpacity onPress={() => adjustToken(name, -1)} style={s.tokenBtnMinus}>
                        <Text style={s.tokenBtnText}>−</Text>
                      </TouchableOpacity>
                      <View style={s.tokenBadge}>
                        <Text style={s.tokenCount}>{t}</Text>
                      </View>
                      <TouchableOpacity onPress={() => adjustToken(name, 1)} style={s.tokenBtnPlus}>
                        <Text style={s.tokenBtnText}>+</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}

              <View style={s.addStudentRow}>
                <TextInput
                  style={[s.textInput, { flex: 1, marginTop: 0, marginBottom: 0 }]}
                  value={newStudentName}
                  onChangeText={setNewStudentName}
                  placeholder="Student name…"
                  onSubmitEditing={addStudent}
                  returnKeyType="done"
                />
                <TouchableOpacity onPress={addStudent} style={s.addStudentBtn}>
                  <Text style={s.addStudentBtnText}>Add</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      )}
    </View>
  );

  // ─── Root render ─────────────────────────────────────────────────────────────

  return (
    <View>
      {/* Tab bar */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tabRow}>
        {TABS.map(({ key, icon }) => (
          <TouchableOpacity
            key={key}
            onPress={() => setActiveTab(key)}
            style={[s.tab, activeTab === key && s.tabActive]}
          >
            <Text style={[s.tabIcon]}>{icon}</Text>
            <Text style={[s.tabText, activeTab === key && s.tabTextActive]}>{key}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <View style={s.tabContent}>
        {activeTab === 'Schedule'    && renderScheduleTab()}
        {activeTab === 'Attendance'  && renderAttendanceTab()}
        {activeTab === 'Class Notes' && renderClassNotesTab()}
        {activeTab === 'Tokens'      && renderTokensTab()}
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const createClassEditStyles = (theme = {}) => {
  const colors = {
    surface: theme.surface || '#fff',
    surfaceSoft: theme.surfaceSoft || '#f7f9fc',
    chip: theme.chip || '#f0f4f9',
    border: theme.border || '#d8e2ed',
    text: theme.text || '#1f2d3d',
    muted: theme.muted || '#667789',
    mutedStrong: theme.mutedStrong || '#46586b',
    primary: theme.primary || '#174ea6',
    inputText: theme.inputText || '#1f2d3d',
    placeholder: theme.placeholder || '#9aaabb',
  };

  return StyleSheet.create({
  // Tab bar
  tabRow: { gap: 6, paddingBottom: 2 },
  tab: {
    alignItems: 'center',
    backgroundColor: colors.chip,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minWidth: 80,
  },
  tabActive: { backgroundColor: colors.primary },
  tabIcon: { fontSize: 18, marginBottom: 2 },
  tabText: { color: colors.mutedStrong, fontSize: 11, fontWeight: '800' },
  tabTextActive: { color: '#fff' },
  tabContent: { marginTop: 16 },

  // Date chips
  chipRow: { gap: 8, paddingBottom: 4 },
  dateChip: {
    alignItems: 'center',
    backgroundColor: colors.chip,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minWidth: 76,
  },
  dateChipActive: { backgroundColor: colors.primary },
  dateChipLabel: { color: colors.text, fontSize: 13, fontWeight: '800' },
  dateChipLabelActive: { color: '#fff' },
  dateChipSub: { color: colors.muted, fontSize: 10, marginTop: 2 },
  dateChipSubActive: { color: '#bfcfff' },

  // Section row (label + action)
  sectionRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: 14, marginBottom: 6 },
  sectionCount: { color: colors.mutedStrong, fontSize: 13, fontWeight: '800' },
  exportMini: { backgroundColor: colors.chip, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  exportMiniText: { color: colors.primary, fontSize: 12, fontWeight: '800' },

  // Slot cards
  slotCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 8,
    padding: 14,
  },
  slotCardSelected: { borderColor: colors.primary, borderWidth: 2, backgroundColor: colors.surfaceSoft },
  slotCardRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  slotSubject: { color: colors.text, fontSize: 15, fontWeight: '800' },
  slotMeta: { color: colors.muted, fontSize: 12, marginTop: 3 },
  slotTeacher: { color: colors.mutedStrong, fontSize: 13, fontWeight: '700', marginTop: 6 },
  editHint: { color: colors.primary, fontSize: 11, marginTop: 6, fontWeight: '700' },
  selectedTick: { color: colors.primary, fontSize: 22, fontWeight: '800' },

  // Type badge
  typeBadge: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 4, alignSelf: 'flex-start', marginBottom: 4 },
  typeBadgeText: { fontSize: 11, fontWeight: '800' },

  // General chips
  chip: { backgroundColor: colors.chip, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9 },
  chipOn: { backgroundColor: colors.primary },
  chipText: { color: colors.text, fontSize: 13, fontWeight: '700' },
  chipTextOn: { color: '#fff' },

  // Labels, inputs
  fieldLabel: { color: colors.mutedStrong, fontSize: 11, fontWeight: '800', marginTop: 18, marginBottom: 6, textTransform: 'uppercase' },
  textInput: {
    backgroundColor: colors.surfaceSoft, borderColor: colors.border, borderRadius: 8, borderWidth: 1,
    color: colors.inputText, fontSize: 14, marginBottom: 8, padding: 12,
  },
  textArea: { minHeight: 72, textAlignVertical: 'top' },
  searchBox: {
    backgroundColor: colors.surfaceSoft, borderColor: colors.border, borderRadius: 8, borderWidth: 1,
    color: colors.inputText, fontSize: 14, marginBottom: 8, padding: 11,
  },

  // Modal
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  modal: {
    backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    maxHeight: '88%', padding: 20, paddingBottom: 0,
  },
  modalTitle: { color: colors.text, fontSize: 20, fontWeight: '800' },
  modalSub: { color: colors.muted, fontSize: 13, marginTop: 3, marginBottom: 2 },
  modalFooter: { flexDirection: 'row', gap: 10, marginBottom: 28, marginTop: 22 },
  btnCancel: { alignItems: 'center', backgroundColor: colors.chip, borderRadius: 10, flex: 1, padding: 15 },
  btnCancelText: { color: colors.text, fontSize: 15, fontWeight: '800' },
  btnSave: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: 10, flex: 1, padding: 15 },
  btnSaveText: { color: '#fff', fontSize: 15, fontWeight: '800' },

  // Attendance
  attendActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  attendBtn: { alignItems: 'center', borderRadius: 12, flex: 1, paddingVertical: 18 },
  attendBtnIn: { backgroundColor: '#2e7d32' },
  attendBtnOut: { backgroundColor: '#c62828' },
  attendBtnDim: { opacity: 0.38 },
  attendBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  attendBtnSub: { color: 'rgba(255,255,255,0.75)', fontSize: 11, marginTop: 4 },
  sessionLog: {
    backgroundColor: colors.surfaceSoft, borderColor: colors.border, borderRadius: 10,
    borderWidth: 1, marginTop: 16, padding: 14,
  },
  sessionLogTitle: { color: colors.text, fontSize: 14, fontWeight: '800' },
  sessionRow: { alignItems: 'center', borderTopColor: colors.border, borderTopWidth: 1, flexDirection: 'row', gap: 10, marginTop: 10, paddingTop: 10 },
  sessionDot: { backgroundColor: '#9e9e9e', borderRadius: 6, height: 12, width: 12 },
  sessionDotOpen: { backgroundColor: '#2e7d32' },
  sessionLabel: { color: colors.mutedStrong, fontSize: 12, fontWeight: '800' },
  sessionTime: { color: colors.text, fontSize: 13, marginTop: 2 },
  activePill: { backgroundColor: '#e8f5e9', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  activePillText: { color: '#2e7d32', fontSize: 10, fontWeight: '800' },

  // Class notes
  notesForm: {
    backgroundColor: colors.surfaceSoft, borderColor: colors.border, borderRadius: 10,
    borderWidth: 1, marginTop: 14, padding: 14,
  },
  notesFormTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
  notesFormSub: { color: colors.muted, fontSize: 12, marginTop: 3 },
  changeMini: { alignSelf: 'flex-start', backgroundColor: colors.chip, borderRadius: 8, marginTop: 10, paddingHorizontal: 10, paddingVertical: 8 },
  changeMiniText: { color: colors.primary, fontSize: 12, fontWeight: '800' },
  notesBtns: { flexDirection: 'row', gap: 10, marginTop: 14 },
  exportFull: { alignItems: 'center', backgroundColor: colors.chip, borderRadius: 10, flex: 1, padding: 15 },
  exportFullText: { color: colors.primary, fontSize: 14, fontWeight: '800' },

  // Tokens
  studentRow: {
    alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border,
    borderRadius: 10, borderWidth: 1, flexDirection: 'row',
    justifyContent: 'space-between', marginTop: 8, padding: 12,
  },
  studentName: { color: colors.text, flex: 1, fontSize: 14, fontWeight: '700' },
  tokenControls: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  tokenBtnMinus: { alignItems: 'center', backgroundColor: '#feeceb', borderRadius: 8, height: 36, justifyContent: 'center', width: 36 },
  tokenBtnPlus: { alignItems: 'center', backgroundColor: '#e8f5e9', borderRadius: 8, height: 36, justifyContent: 'center', width: 36 },
  tokenBtnText: { fontSize: 20, fontWeight: '800', color: colors.text },
  tokenBadge: { alignItems: 'center', backgroundColor: colors.chip, borderRadius: 8, minWidth: 40, paddingHorizontal: 10, paddingVertical: 6 },
  tokenCount: { color: colors.primary, fontSize: 18, fontWeight: '800' },
  addStudentRow: { alignItems: 'center', flexDirection: 'row', gap: 8, marginTop: 14 },
  addStudentBtn: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: 10, padding: 14 },
  addStudentBtnText: { color: '#fff', fontSize: 14, fontWeight: '800' },

  // Empty / misc
  emptyMsg: { color: colors.placeholder, fontSize: 13, marginTop: 16, textAlign: 'center', lineHeight: 20 },
  emptyCard: { alignItems: 'center', backgroundColor: colors.surfaceSoft, borderRadius: 10, marginTop: 16, padding: 24 },
  emptyCardText: { color: colors.mutedStrong, fontSize: 14, fontWeight: '700', textAlign: 'center' },
  emptyCardSub: { color: colors.placeholder, fontSize: 12, marginTop: 6, textAlign: 'center' },
  exportBtn: { alignItems: 'center', backgroundColor: colors.chip, borderRadius: 10, marginTop: 10, padding: 13 },
  exportBtnText: { color: colors.primary, fontSize: 14, fontWeight: '800' },
  });
};
