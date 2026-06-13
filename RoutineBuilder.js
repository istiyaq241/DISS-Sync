import React, { useState, useMemo } from 'react';
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
import { doc, writeBatch } from 'firebase/firestore';
import { db } from './firebaseConfig';

// ─── Constants ────────────────────────────────────────────────────────────────

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday'];

const REGULAR_CLASSES = ['Pre-Class', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

const TEACHERS = [
  'Abdullah', 'Ashraful', 'Fahim', 'Farhana', 'Goutam',
  'Ishtiaque', 'Nazrul', 'Principal', 'Rafi', 'Riaz',
  'Sadia', 'Shimanto', 'Sumayera',
];

const SUBJECTS = [
  'Agriculture', 'BGS', 'Bangla', 'Bangla 1', 'Bangla 2', 'Biology',
  'Chemistry', 'Civics', 'English', 'English 1', 'English 2', 'GK',
  'General Math', 'H Math + Geo', 'Higher Math', 'History', 'Islam',
  'Math', 'Physical Ed', 'Physics', 'Pre-Class', 'Science',
];

const ROOMS = ['100', '101', '102', '103', '104', '105', '106', '107', '108', '109', '110'];

const CLASS_TYPES = ['Regular', 'Exam', 'Extra', 'Makeup'];

// Regular 40-min slots (Pre-Class + Classes 1–9)
// Class 10 60-min slots shown separately within the same list
const ALL_SLOT_DEFS = [
  { start: '08:30 AM', end: '09:10 AM', forClasses: REGULAR_CLASSES },
  { start: '08:30 AM', end: '09:30 AM', forClasses: ['10'] },
  { start: '09:10 AM', end: '09:50 AM', forClasses: REGULAR_CLASSES },
  { start: '09:30 AM', end: '10:30 AM', forClasses: ['10'] },
  { start: '09:50 AM', end: '10:30 AM', forClasses: REGULAR_CLASSES },
  { start: '10:30 AM', end: '11:05 AM', forClasses: REGULAR_CLASSES },
  { start: '10:30 AM', end: '11:30 AM', forClasses: ['10'] },
  { start: '11:05 AM', end: '11:40 AM', forClasses: REGULAR_CLASSES },
  { start: '11:30 AM', end: '12:30 PM', forClasses: ['10'] },
  { start: '11:45 AM', end: '12:25 PM', forClasses: REGULAR_CLASSES },
  { start: '12:25 PM', end: '01:05 PM', forClasses: REGULAR_CLASSES },
  { start: '12:30 PM', end: '01:30 PM', forClasses: ['10'] },
  { start: '01:05 PM', end: '01:45 PM', forClasses: REGULAR_CLASSES },
  { start: '02:30 PM', end: '03:10 PM', forClasses: REGULAR_CLASSES },
  { start: '02:30 PM', end: '03:30 PM', forClasses: ['10'] },
  { start: '03:10 PM', end: '03:50 PM', forClasses: REGULAR_CLASSES },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function RoutineBuilder({ schedules, onSaved }) {
  const [selectedDay, setSelectedDay] = useState('Sunday');
  const [editingEntry, setEditingEntry] = useState(null); // { slotDef, classNo, existing }
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);
  const [teacherSearch, setTeacherSearch] = useState('');
  const [subjectSearch, setSubjectSearch] = useState('');

  // ── Derived lookups ──────────────────────────────────────────────────────────

  // "day||classNo||time" → schedule item (classNo already normalized to Pre-Class or "1".."10")
  const slotMap = useMemo(() => {
    const map = {};
    schedules.forEach((item) => {
      const key = `${item.day}||${item.classNo}||${item.time}`;
      map[key] = item;
    });
    return map;
  }, [schedules]);

  // For conflict detection on the selected day
  const { teacherMap, roomMap } = useMemo(() => {
    const tMap = {}; // teacherName → timeStr → [classNo]
    const rMap = {}; // roomNo     → timeStr → [classNo]

    schedules
      .filter((s) => s.day === selectedDay)
      .forEach((s) => {
        if (s.teacherName && s.teacherName !== 'Unknown teacher') {
          if (!tMap[s.teacherName]) tMap[s.teacherName] = {};
          if (!tMap[s.teacherName][s.time]) tMap[s.teacherName][s.time] = [];
          tMap[s.teacherName][s.time].push(s.classNo);
        }
        if (s.roomNo && s.roomNo !== 'TBA') {
          if (!rMap[s.roomNo]) rMap[s.roomNo] = {};
          if (!rMap[s.roomNo][s.time]) rMap[s.roomNo][s.time] = [];
          rMap[s.roomNo][s.time].push(s.classNo);
        }
      });

    return { teacherMap: tMap, roomMap: rMap };
  }, [schedules, selectedDay]);

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const getAssignment = (classNo, start, end) =>
    slotMap[`${selectedDay}||${classNo}||${start} - ${end}`] || null;

  const teacherConflict = (teacherName, timeStr, thisClassNo) => {
    if (!teacherName || teacherName === 'Unknown teacher') return false;
    return (teacherMap[teacherName]?.[timeStr] || []).some((c) => c !== thisClassNo);
  };

  const roomConflict = (roomNo, timeStr, thisClassNo) => {
    if (!roomNo || roomNo === 'TBA') return false;
    return (roomMap[roomNo]?.[timeStr] || []).some((c) => c !== thisClassNo);
  };

  // ── Actions ──────────────────────────────────────────────────────────────────

  const openEdit = (slotDef, classNo) => {
    const existing = getAssignment(classNo, slotDef.start, slotDef.end);
    setDraft({
      teacherName: existing?.teacherName || '',
      subject: existing?.subject || '',
      roomNo: existing?.roomNo || '',
      classType: existing?.classType || 'Regular',
    });
    setTeacherSearch('');
    setSubjectSearch('');
    setEditingEntry({ slotDef, classNo, existing });
  };

  const handleSave = async () => {
    if (!draft.teacherName || !draft.subject || !draft.roomNo) {
      Alert.alert('Missing info', 'Please select a Teacher, Subject, and Room before saving.');
      return;
    }

    setSaving(true);
    try {
      const { slotDef, classNo, existing } = editingEntry;
      const classNoRaw = classNo === 'Pre-Class' ? '0' : classNo;
      const record = {
        Teacher_ID: '',
        Teacher_Name: draft.teacherName,
        Class_No: classNoRaw,
        Subject: draft.subject,
        Room_No: draft.roomNo,
        Date: '',
        Day: selectedDay,
        Start_Time: slotDef.start,
        End_Time: slotDef.end,
        Class_Type: draft.classType || 'Regular',
        Modified_By: 'RoutineBuilder',
      };

      const id = existing?.id || `RB-${Date.now()}-C${classNoRaw}-${selectedDay.slice(0, 3)}`;
      const batch = writeBatch(db);
      batch.set(doc(db, 'schedules', id), record);
      await batch.commit();

      setEditingEntry(null);
      onSaved?.();
    } catch (err) {
      Alert.alert('Save failed', err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleClear = () => {
    const { existing } = editingEntry;
    if (!existing?.id) {
      setEditingEntry(null);
      return;
    }

    Alert.alert(
      'Clear this slot?',
      'This removes the assignment from Firebase.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            setSaving(true);
            try {
              const batch = writeBatch(db);
              batch.delete(doc(db, 'schedules', existing.id));
              await batch.commit();
              setEditingEntry(null);
              onSaved?.();
            } catch (err) {
              Alert.alert('Failed', err.message);
            } finally {
              setSaving(false);
            }
          },
        },
      ],
    );
  };

  // ── Filtered lists for modal ─────────────────────────────────────────────────

  const filteredTeachers = TEACHERS.filter(
    (t) => !teacherSearch || t.toLowerCase().includes(teacherSearch.toLowerCase()),
  );
  const filteredSubjects = SUBJECTS.filter(
    (s) => !subjectSearch || s.toLowerCase().includes(subjectSearch.toLowerCase()),
  );

  // ── Modal conflict checks ────────────────────────────────────────────────────

  const modalTimeStr = editingEntry
    ? `${editingEntry.slotDef.start} - ${editingEntry.slotDef.end}`
    : '';

  const draftTeacherConflict =
    editingEntry && draft.teacherName
      ? teacherConflict(draft.teacherName, modalTimeStr, editingEntry.classNo)
      : false;

  const draftRoomConflict =
    editingEntry && draft.roomNo
      ? roomConflict(draft.roomNo, modalTimeStr, editingEntry.classNo)
      : false;

  // ── Render ───────────────────────────────────────────────────────────────────

  const renderSlotSection = (slotDef, index) => {
    const timeStr = `${slotDef.start} - ${slotDef.end}`;
    const isClass10 = slotDef.forClasses.length === 1 && slotDef.forClasses[0] === '10';

    return (
      <View key={index} style={styles.slotSection}>
        <View style={styles.slotHeader}>
          <Text style={styles.slotTime}>{slotDef.start} – {slotDef.end}</Text>
          {isClass10 && <Text style={styles.slotBadge}>Class 10 (60 min)</Text>}
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.classRow}
        >
          {slotDef.forClasses.map((classNo) => {
            const item = getAssignment(classNo, slotDef.start, slotDef.end);
            const tConflict = item ? teacherConflict(item.teacherName, timeStr, classNo) : false;
            const rConflict = item ? roomConflict(item.roomNo, timeStr, classNo) : false;
            const conflict = tConflict || rConflict;

            return (
              <TouchableOpacity
                key={classNo}
                onPress={() => openEdit(slotDef, classNo)}
                style={[
                  styles.classCard,
                  item && styles.classCardFilled,
                  conflict && styles.classCardConflict,
                ]}
              >
                <Text style={[styles.classLabel, item && styles.classLabelFilled]}>
                  {classNo === 'Pre-Class' ? 'Pre' : `Cl. ${classNo}`}
                </Text>

                {item ? (
                  <>
                    <Text style={styles.cardTeacher} numberOfLines={1}>{item.teacherName}</Text>
                    <Text style={styles.cardSubject} numberOfLines={1}>{item.subject}</Text>
                    <Text style={styles.cardRoom}>Rm {item.roomNo}</Text>
                    {conflict && <Text style={styles.conflictBadge}>⚠ Conflict</Text>}
                  </>
                ) : (
                  <Text style={styles.cardEmpty}>Tap to{'\n'}assign</Text>
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
    );
  };

  return (
    <View style={styles.wrapper}>
      {/* ── Day selector ── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.dayRow}
      >
        {DAYS.map((day) => (
          <TouchableOpacity
            key={day}
            onPress={() => setSelectedDay(day)}
            style={[styles.dayChip, selectedDay === day && styles.dayChipActive]}
          >
            <Text style={[styles.dayText, selectedDay === day && styles.dayTextActive]}>
              {day}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <Text style={styles.hint}>
        Tap any class card to assign or edit. ⚠ marks a conflict.
      </Text>

      {/* ── Slot list ── */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.slotList}
      >
        {ALL_SLOT_DEFS.map(renderSlotSection)}
      </ScrollView>

      {/* ── Edit modal ── */}
      {!!editingEntry && (
        <Modal visible animationType="slide" transparent>
          <View style={styles.overlay}>
            <View style={styles.modal}>
              <ScrollView
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
                {/* Header */}
                <Text style={styles.modalTitle}>
                  {editingEntry.classNo === 'Pre-Class'
                    ? 'Pre-Class'
                    : `Class ${editingEntry.classNo}`}
                </Text>
                <Text style={styles.modalSub}>
                  {selectedDay} · {editingEntry.slotDef.start} – {editingEntry.slotDef.end}
                </Text>

                {/* Teacher */}
                <Text style={styles.fieldLabel}>Teacher</Text>
                <TextInput
                  style={styles.searchBox}
                  value={teacherSearch}
                  onChangeText={setTeacherSearch}
                  placeholder={draft.teacherName || 'Search teacher…'}
                  placeholderTextColor={draft.teacherName ? '#1f2d3d' : '#9aaabb'}
                />
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.chipRow}
                >
                  {filteredTeachers.map((t) => (
                    <TouchableOpacity
                      key={t}
                      onPress={() => {
                        setDraft((d) => ({ ...d, teacherName: t }));
                        setTeacherSearch('');
                      }}
                      style={[styles.chip, draft.teacherName === t && styles.chipOn]}
                    >
                      <Text style={[styles.chipText, draft.teacherName === t && styles.chipTextOn]}>
                        {t}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                {draftTeacherConflict && (
                  <Text style={styles.conflictMsg}>
                    ⚠ {draft.teacherName} is already booked at this time!
                  </Text>
                )}

                {/* Subject */}
                <Text style={styles.fieldLabel}>Subject</Text>
                <TextInput
                  style={styles.searchBox}
                  value={subjectSearch}
                  onChangeText={setSubjectSearch}
                  placeholder={draft.subject || 'Search subject…'}
                  placeholderTextColor={draft.subject ? '#1f2d3d' : '#9aaabb'}
                />
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.chipRow}
                >
                  {filteredSubjects.map((s) => (
                    <TouchableOpacity
                      key={s}
                      onPress={() => {
                        setDraft((d) => ({ ...d, subject: s }));
                        setSubjectSearch('');
                      }}
                      style={[styles.chip, draft.subject === s && styles.chipOn]}
                    >
                      <Text style={[styles.chipText, draft.subject === s && styles.chipTextOn]}>
                        {s}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                {/* Room */}
                <Text style={styles.fieldLabel}>Room</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.chipRow}
                >
                  {ROOMS.map((r) => (
                    <TouchableOpacity
                      key={r}
                      onPress={() => setDraft((d) => ({ ...d, roomNo: r }))}
                      style={[styles.chip, draft.roomNo === r && styles.chipOn]}
                    >
                      <Text style={[styles.chipText, draft.roomNo === r && styles.chipTextOn]}>
                        Rm {r}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                {draftRoomConflict && (
                  <Text style={styles.conflictMsg}>
                    ⚠ Room {draft.roomNo} is already booked at this time!
                  </Text>
                )}

                {/* Class type */}
                <Text style={styles.fieldLabel}>Class Type</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.chipRow}
                >
                  {CLASS_TYPES.map((ct) => (
                    <TouchableOpacity
                      key={ct}
                      onPress={() => setDraft((d) => ({ ...d, classType: ct }))}
                      style={[styles.chip, draft.classType === ct && styles.chipOn]}
                    >
                      <Text style={[styles.chipText, draft.classType === ct && styles.chipTextOn]}>
                        {ct}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                {/* Buttons */}
                <View style={styles.modalFooter}>
                  <TouchableOpacity
                    onPress={() => setEditingEntry(null)}
                    style={styles.btnCancel}
                  >
                    <Text style={styles.btnCancelText}>Cancel</Text>
                  </TouchableOpacity>

                  {!!editingEntry.existing && (
                    <TouchableOpacity
                      onPress={handleClear}
                      style={styles.btnDelete}
                      disabled={saving}
                    >
                      <Text style={styles.btnDeleteText}>Clear</Text>
                    </TouchableOpacity>
                  )}

                  <TouchableOpacity
                    onPress={handleSave}
                    style={styles.btnSave}
                    disabled={saving}
                  >
                    {saving
                      ? <ActivityIndicator color="#fff" />
                      : <Text style={styles.btnSaveText}>Save</Text>}
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  wrapper: { flex: 1 },
  // Day row
  dayRow: { gap: 8, paddingBottom: 10 },
  dayChip: {
    backgroundColor: '#edf2f7', borderRadius: 8,
    paddingHorizontal: 14, paddingVertical: 9,
  },
  dayChipActive: { backgroundColor: '#174ea6' },
  dayText: { color: '#2f4052', fontSize: 13, fontWeight: '800' },
  dayTextActive: { color: '#fff' },
  hint: { color: '#667789', fontSize: 12, marginBottom: 12 },
  // Slot list
  slotList: { paddingBottom: 32, gap: 4 },
  slotSection: { marginBottom: 14 },
  slotHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  slotTime: { color: '#1f2d3d', fontSize: 13, fontWeight: '800' },
  slotBadge: {
    backgroundColor: '#fde7c9', borderRadius: 6,
    color: '#c26400', fontSize: 10, fontWeight: '800',
    paddingHorizontal: 6, paddingVertical: 2,
  },
  // Class cards
  classRow: { gap: 8 },
  classCard: {
    backgroundColor: '#f7f9fc',
    borderColor: '#dce5ef',
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 78,
    padding: 8,
    width: 96,
  },
  classCardFilled: { backgroundColor: '#e8f0fe', borderColor: '#174ea6' },
  classCardConflict: { backgroundColor: '#feeceb', borderColor: '#d93025', borderWidth: 1.5 },
  classLabel: { color: '#9aaabb', fontSize: 10, fontWeight: '800', textTransform: 'uppercase', marginBottom: 4 },
  classLabelFilled: { color: '#174ea6' },
  cardTeacher: { color: '#1f2d3d', fontSize: 12, fontWeight: '800' },
  cardSubject: { color: '#46586b', fontSize: 11, marginTop: 2 },
  cardRoom: { color: '#667789', fontSize: 10, marginTop: 2 },
  cardEmpty: { color: '#b0bec9', fontSize: 11, marginTop: 4, lineHeight: 16 },
  conflictBadge: { color: '#d93025', fontSize: 9, fontWeight: '800', marginTop: 3 },
  // Modal
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.52)', justifyContent: 'flex-end' },
  modal: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '88%',
    padding: 20,
    paddingBottom: 0,
  },
  modalTitle: { color: '#1f2d3d', fontSize: 20, fontWeight: '800' },
  modalSub: { color: '#667789', fontSize: 13, marginBottom: 4, marginTop: 2 },
  fieldLabel: {
    color: '#46586b', fontSize: 11, fontWeight: '800',
    marginTop: 18, marginBottom: 6, textTransform: 'uppercase',
  },
  searchBox: {
    backgroundColor: '#f7f9fc', borderColor: '#d8e2ed',
    borderRadius: 8, borderWidth: 1,
    color: '#1f2d3d', fontSize: 14,
    marginBottom: 8, padding: 10,
  },
  chipRow: { gap: 8, paddingVertical: 4 },
  chip: {
    backgroundColor: '#edf2f7', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 8,
  },
  chipOn: { backgroundColor: '#174ea6' },
  chipText: { color: '#2f4052', fontSize: 13, fontWeight: '700' },
  chipTextOn: { color: '#fff' },
  conflictMsg: { color: '#d93025', fontSize: 12, fontWeight: '700', marginTop: 5 },
  modalFooter: { flexDirection: 'row', gap: 10, marginBottom: 28, marginTop: 24 },
  btnCancel: {
    alignItems: 'center', backgroundColor: '#edf2f7',
    borderRadius: 8, flex: 1, padding: 14,
  },
  btnCancelText: { color: '#2f4052', fontSize: 15, fontWeight: '800' },
  btnDelete: {
    alignItems: 'center', backgroundColor: '#feeceb',
    borderRadius: 8, padding: 14, paddingHorizontal: 18,
  },
  btnDeleteText: { color: '#d93025', fontSize: 15, fontWeight: '800' },
  btnSave: {
    alignItems: 'center', backgroundColor: '#174ea6',
    borderRadius: 8, flex: 1, padding: 14,
  },
  btnSaveText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
