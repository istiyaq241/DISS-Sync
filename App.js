import React, { useEffect, useMemo, useState } from 'react';
import useAppUpdates from './useAppUpdates';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import { signInAnonymously, signInWithEmailAndPassword, onAuthStateChanged, signOut } from 'firebase/auth';
import { collection, doc, getDocs, writeBatch } from 'firebase/firestore';
import { auth, db } from './firebaseConfig';
import seedRoutine from './data.json';
import RoutineBuilder from './RoutineBuilder';

const DAY_ORDER = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const BASE_SECTIONS = ['My Routine', 'Teachers', 'Students', 'Classes', 'Rooms', 'Admin'];
const CACHE_KEY = 'diss-routine-cache-v1';
const TEACHER_KEY = 'diss-selected-teacher-v1';

const getStorage = () => {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }

  return null;
};

const getFirstValue = (item, keys, fallback = '') => {
  for (const key of keys) {
    const value = item?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }

  return fallback;
};

const parseTimeValue = (value) => {
  const match = String(value || '')
    .trim()
    .match(/^(\d{1,2}):(\d{2})\s?(AM|PM)?$/i);

  if (!match) {
    return 0;
  }

  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const period = match[3]?.toUpperCase();

  if (period === 'PM' && hours !== 12) {
    hours += 12;
  }

  if (period === 'AM' && hours === 12) {
    hours = 0;
  }

  return hours * 60 + minutes;
};

const normalizeSchedule = (item) => {
  const startTime = getFirstValue(item, ['Start_Time', 'start_time', 'startTime', 'start', 'time']);
  const endTime = getFirstValue(item, ['End_Time', 'end_time', 'endTime', 'end']);
  const rawClassNo = getFirstValue(item, ['Class_No', 'class_no', 'classNo', 'class', 'section'], 'N/A');
  const classNo = rawClassNo === '0' ? 'Pre-Class' : rawClassNo;

  return {
    id: getFirstValue(item, ['ID', 'id'], item.id),
    teacherId: getFirstValue(item, ['Teacher_ID', 'teacher_id', 'teacherId']),
    teacherName: getFirstValue(item, ['Teacher_Name', 'teacher_name', 'teacher', 'faculty'], 'Unknown teacher'),
    classNo,
    subject: getFirstValue(item, ['Subject', 'subject', 'course_title', 'course_name'], 'Untitled subject'),
    courseCode: getFirstValue(item, ['Course_Code', 'course_code', 'course_id']),
    roomNo: getFirstValue(item, ['Room_No', 'room_no', 'room', 'roomNo'], 'TBA'),
    date: getFirstValue(item, ['Date', 'date']),
    day: getFirstValue(item, ['Day', 'day'], 'Unscheduled'),
    time: endTime ? `${startTime} - ${endTime}` : startTime || 'TBA',
    startSort: parseTimeValue(startTime),
    classType: getFirstValue(item, ['Class_Type', 'class_type', 'classType'], 'Regular'),
    modifiedBy: getFirstValue(item, ['Modified_By', 'modified_by', 'modifiedBy']),
  };
};

const sortSchedule = (a, b) => {
  const dayA = DAY_ORDER.indexOf(a.day);
  const dayB = DAY_ORDER.indexOf(b.day);
  const safeDayA = dayA === -1 ? 99 : dayA;
  const safeDayB = dayB === -1 ? 99 : dayB;

  if (safeDayA !== safeDayB) {
    return safeDayA - safeDayB;
  }

  if (a.startSort !== b.startSort) {
    return a.startSort - b.startSort;
  }

  return a.teacherName.localeCompare(b.teacherName);
};

const sameText = (left, right) => left.trim().toLowerCase() === right.trim().toLowerCase();
const includesText = (value, search) => value.toLowerCase().includes(search.trim().toLowerCase());
const getTodayName = () => DAY_ORDER[new Date().getDay()];
const SEED_SCHEDULES = seedRoutine.map((item, index) => normalizeSchedule({ id: `seed-${index}`, ...item })).sort(sortSchedule);
const REQUIRED_UPLOAD_COLUMNS = ['Teacher_ID', 'Teacher_Name', 'Class_No', 'Subject', 'Room_No', 'Date', 'Day', 'Start_Time', 'End_Time', 'Class_Type'];

const columnNameToIndex = (name) => {
  let index = 0;

  for (let i = 0; i < name.length; i += 1) {
    index = index * 26 + name.charCodeAt(i) - 64;
  }

  return index - 1;
};

const parseCellReference = (reference) => {
  const match = String(reference || '').match(/^([A-Z]+)(\d+)$/i);

  if (!match) {
    return { column: 0, row: 0 };
  }

  return { column: columnNameToIndex(match[1].toUpperCase()), row: Number(match[2]) - 1 };
};

const readTextFromBlob = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(reader.error);
  reader.readAsText(blob);
});

const readBufferFromBlob = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(reader.error);
  reader.readAsArrayBuffer(blob);
});

const decodeUtf8 = (bytes) => new TextDecoder('utf-8').decode(bytes);

const findZipEntries = (buffer) => {
  const view = new DataView(buffer);
  let eocdOffset = -1;

  for (let offset = view.byteLength - 22; offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      eocdOffset = offset;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new Error('Could not read the Excel file. Please export it again as .xlsx or .csv.');
  }

  const entryCount = view.getUint16(eocdOffset + 10, true);
  let directoryOffset = view.getUint32(eocdOffset + 16, true);
  const entries = {};

  for (let index = 0; index < entryCount; index += 1) {
    if (view.getUint32(directoryOffset, true) !== 0x02014b50) {
      throw new Error('The Excel file structure could not be read.');
    }

    const compression = view.getUint16(directoryOffset + 10, true);
    const compressedSize = view.getUint32(directoryOffset + 20, true);
    const fileNameLength = view.getUint16(directoryOffset + 28, true);
    const extraLength = view.getUint16(directoryOffset + 30, true);
    const commentLength = view.getUint16(directoryOffset + 32, true);
    const localHeaderOffset = view.getUint32(directoryOffset + 42, true);
    const fileNameBytes = new Uint8Array(buffer, directoryOffset + 46, fileNameLength);
    const fileName = decodeUtf8(fileNameBytes);

    entries[fileName] = { compression, compressedSize, localHeaderOffset };
    directoryOffset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
};

const extractZipText = async (buffer, entries, fileName) => {
  const entry = entries[fileName];

  if (!entry) {
    return '';
  }

  const view = new DataView(buffer);
  const nameLength = view.getUint16(entry.localHeaderOffset + 26, true);
  const extraLength = view.getUint16(entry.localHeaderOffset + 28, true);
  const start = entry.localHeaderOffset + 30 + nameLength + extraLength;
  const compressedBytes = new Uint8Array(buffer, start, entry.compressedSize);

  if (entry.compression === 0) {
    return decodeUtf8(compressedBytes);
  }

  if (entry.compression !== 8 || typeof DecompressionStream === 'undefined') {
    throw new Error('This browser cannot unzip the Excel file. Please use Chrome/Edge or upload a CSV file.');
  }

  const stream = new Blob([compressedBytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const textBlob = await new Response(stream).blob();
  return readTextFromBlob(textBlob);
};

const readSharedStrings = (xmlDocument) => {
  if (!xmlDocument) {
    return [];
  }

  return Array.from(xmlDocument.getElementsByTagName('si')).map((item) => {
    return Array.from(item.getElementsByTagName('t')).map((node) => node.textContent || '').join('');
  });
};

const excelSerialDateToText = (value) => {
  const serial = Number(value);

  if (!Number.isFinite(serial)) {
    return value;
  }

  const date = new Date(Date.UTC(1899, 11, 30 + serial));
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const year = date.getUTCFullYear();
  return `${day}/${month}/${year}`;
};

const readCellValue = (cell, sharedStrings, header) => {
  const type = cell.getAttribute('t');
  const valueNode = cell.getElementsByTagName('v')[0];
  const inlineNode = cell.getElementsByTagName('t')[0];
  let value = valueNode?.textContent || inlineNode?.textContent || '';

  if (type === 's') {
    value = sharedStrings[Number(value)] || '';
  }

  if (header === 'Date' && /^\d+(\.\d+)?$/.test(value)) {
    return excelSerialDateToText(value);
  }

  return String(value).trim();
};

const rowsToRecords = (rows) => {
  const headers = rows[0] || [];
  const missing = REQUIRED_UPLOAD_COLUMNS.filter((column) => !headers.includes(column));

  if (missing.length) {
    throw new Error(`Missing required columns: ${missing.join(', ')}`);
  }

  return rows.slice(1)
    .map((row, index) => {
      const record = {};

      headers.forEach((header, columnIndex) => {
        if (header) {
          record[header] = String(row[columnIndex] || '').trim();
        }
      });

      if (!record.ID) {
        record.ID = `SCH-${String(index + 1).padStart(4, '0')}`;
      }

      return record;
    })
    .filter((record) => record.Teacher_Name || record.Subject || record.Class_No);
};

const parseCsvRows = (text) => {
  const rows = [];
  let current = '';
  let row = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const nextCharacter = text[index + 1];

    if (character === '"' && nextCharacter === '"') {
      current += '"';
      index += 1;
    } else if (character === '"') {
      inQuotes = !inQuotes;
    } else if (character === ',' && !inQuotes) {
      row.push(current.trim());
      current = '';
    } else if ((character === '\n' || character === '\r') && !inQuotes) {
      if (character === '\r' && nextCharacter === '\n') {
        index += 1;
      }
      row.push(current.trim());
      if (row.some(Boolean)) {
        rows.push(row);
      }
      row = [];
      current = '';
    } else {
      current += character;
    }
  }

  row.push(current.trim());
  if (row.some(Boolean)) {
    rows.push(row);
  }

  return rows;
};

const parseXlsxRecords = async (file) => {
  const buffer = await readBufferFromBlob(file);
  const entries = findZipEntries(buffer);
  const parser = new DOMParser();
  const sharedStringsXml = await extractZipText(buffer, entries, 'xl/sharedStrings.xml');
  const sheetXml = await extractZipText(buffer, entries, 'xl/worksheets/sheet1.xml');
  const sharedStrings = readSharedStrings(sharedStringsXml ? parser.parseFromString(sharedStringsXml, 'text/xml') : null);
  const sheetDocument = parser.parseFromString(sheetXml, 'text/xml');
  const rows = [];

  Array.from(sheetDocument.getElementsByTagName('row')).forEach((rowNode) => {
    const row = [];

    Array.from(rowNode.getElementsByTagName('c')).forEach((cell) => {
      const { column } = parseCellReference(cell.getAttribute('r'));
      const header = rows[0]?.[column];
      row[column] = readCellValue(cell, sharedStrings, header);
    });

    rows.push(row);
  });

  return rowsToRecords(rows);
};

const parseScheduleFile = async (file) => {
  const extension = file.name.split('.').pop().toLowerCase();

  if (extension === 'csv') {
    return rowsToRecords(parseCsvRows(await readTextFromBlob(file)));
  }

  if (extension === 'xlsx') {
    return parseXlsxRecords(file);
  }

  throw new Error('Please upload a .xlsx or .csv routine file.');
};

export default function App() {
  useAppUpdates();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [user, setUser] = useState(null);
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [authLoading, setAuthLoading] = useState(false);
  const [activeSection, setActiveSection] = useState('My Routine');
  const [selectedTeacher, setSelectedTeacher] = useState('');
  const [selectedDay, setSelectedDay] = useState(getTodayName());
  const [teacherDraft, setTeacherDraft] = useState('');
  const [teacherLookup, setTeacherLookup] = useState('');
  const [selectedClass, setSelectedClass] = useState('All');
  const [selectedRoom, setSelectedRoom] = useState('All');
  const [syncMessage, setSyncMessage] = useState('Preparing routine...');
  const [uploadStatus, setUploadStatus] = useState('');
  const [uploadingRoutine, setUploadingRoutine] = useState(false);
  const todayName = getTodayName();

  // Show Routine Builder only for admin (email) logins, not anonymous viewers
  const sections = useMemo(() => {
    if (user && !user.isAnonymous) {
      return [...BASE_SECTIONS, 'Routine Builder'];
    }
    return BASE_SECTIONS;
  }, [user]);

  useEffect(() => {
    const savedTeacher = getStorage()?.getItem(TEACHER_KEY);

    if (savedTeacher) {
      setSelectedTeacher(savedTeacher);
      setTeacherDraft(savedTeacher);
      setTeacherLookup(savedTeacher);
    }

    const unsubscribe = onAuthStateChanged(auth, (authenticatedUser) => {
      setUser(authenticatedUser);

      if (authenticatedUser) {
        fetchSchedules();
      } else {
        setSchedules([]);
        setLoading(false);
      }
    });

    return unsubscribe;
  }, []);

  const teacherNames = useMemo(() => {
    return Array.from(new Set(schedules.map((item) => item.teacherName).filter((name) => name && name !== 'Unknown teacher')))
      .sort((a, b) => a.localeCompare(b));
  }, [schedules]);

  const classOptions = useMemo(() => {
    const values = Array.from(new Set(schedules.map((item) => item.classNo).filter(Boolean)));
    return ['All', ...values.sort((a, b) => {
      if (a === 'Pre-Class') {
        return -1;
      }
      if (b === 'Pre-Class') {
        return 1;
      }
      return a.localeCompare(b, undefined, { numeric: true });
    })];
  }, [schedules]);

  const roomOptions = useMemo(() => {
    const values = Array.from(new Set(schedules.map((item) => item.roomNo).filter(Boolean)));
    return ['All', ...values.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))];
  }, [schedules]);

  const teacherDayOptions = useMemo(() => {
    if (!selectedTeacher) {
      return DAY_ORDER;
    }

    const availableDays = new Set(
      schedules
        .filter((item) => sameText(item.teacherName, selectedTeacher))
        .map((item) => item.day),
    );

    const orderedDays = DAY_ORDER.filter((day) => availableDays.has(day));
    return orderedDays.length ? orderedDays : DAY_ORDER;
  }, [schedules, selectedTeacher]);

  const myRoutineSchedule = useMemo(() => {
    if (!selectedTeacher) {
      return [];
    }

    return schedules
      .filter((item) => sameText(item.teacherName, selectedTeacher) && item.day === selectedDay)
      .sort(sortSchedule);
  }, [schedules, selectedDay, selectedTeacher]);

  const teacherLookupSchedule = useMemo(() => {
    const search = teacherLookup.trim();

    if (!search) {
      return [];
    }

    return schedules
      .filter((item) => includesText(item.teacherName, search))
      .sort(sortSchedule);
  }, [schedules, teacherLookup]);

  const studentSchedule = useMemo(() => {
    if (selectedClass === 'All') {
      return [];
    }

    return schedules
      .filter((item) => item.classNo === selectedClass && item.day === todayName)
      .sort(sortSchedule);
  }, [schedules, selectedClass, todayName]);

  const classSchedule = useMemo(() => {
    if (selectedClass === 'All') {
      return [];
    }

    return schedules
      .filter((item) => item.classNo === selectedClass)
      .sort(sortSchedule);
  }, [schedules, selectedClass]);

  const roomSchedule = useMemo(() => {
    if (selectedRoom === 'All') {
      return [];
    }

    return schedules
      .filter((item) => item.roomNo === selectedRoom)
      .sort(sortSchedule);
  }, [schedules, selectedRoom]);

  const loadCachedSchedules = () => {
    const cached = getStorage()?.getItem(CACHE_KEY);
    return cached ? JSON.parse(cached) : [];
  };

  const saveCachedSchedules = (nextSchedules) => {
    getStorage()?.setItem(CACHE_KEY, JSON.stringify(nextSchedules));
  };

  const fetchSchedules = async () => {
    setLoading(true);
    setSyncMessage('Checking Firebase for the latest routine...');

    try {
      const querySnapshot = await getDocs(collection(db, 'schedules'));
      const data = querySnapshot.docs.map((doc) => normalizeSchedule({ id: doc.id, ...doc.data() }));
      const sortedData = data.length ? data.sort(sortSchedule) : SEED_SCHEDULES;

      setSchedules(sortedData);
      saveCachedSchedules(sortedData);
      setSyncMessage(data.length ? 'Routine synced from Firebase.' : 'Showing Excel routine until Firebase has data.');
    } catch (error) {
      const cachedSchedules = loadCachedSchedules();
      const fallbackSchedules = cachedSchedules.length ? cachedSchedules : SEED_SCHEDULES;
      setSchedules(fallbackSchedules);
      setSyncMessage(cachedSchedules.length ? 'Showing saved routine because Firebase was unavailable.' : 'Showing Excel routine while Firebase is unavailable.');
      console.error('Routine sync failed:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      Alert.alert('Missing details', 'Please enter both email and password.');
      return;
    }

    setAuthLoading(true);

    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (error) {
      Alert.alert('Login failed', error.message);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleViewerLogin = async () => {
    setAuthLoading(true);

    try {
      await signInAnonymously(auth);
    } catch (error) {
      Alert.alert('Viewer access failed', error.message);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    setLoading(true);
    await signOut(auth);
    setLoading(false);
  };

  const saveTeacher = (teacherName = teacherDraft) => {
    const cleanName = teacherName.trim();

    if (!cleanName) {
      Alert.alert('Teacher name needed', 'Please type or choose your teacher name first.');
      return;
    }

    setSelectedTeacher(cleanName);
    setTeacherDraft(cleanName);
    setTeacherLookup(cleanName);
    getStorage()?.setItem(TEACHER_KEY, cleanName);
    setSelectedDay(todayName);
    setActiveSection('My Routine');
  };

  const moveTeacherDay = (direction) => {
    const currentIndex = teacherDayOptions.indexOf(selectedDay);
    const safeIndex = currentIndex === -1 ? 0 : currentIndex;
    const nextIndex = (safeIndex + direction + teacherDayOptions.length) % teacherDayOptions.length;
    setSelectedDay(teacherDayOptions[nextIndex]);
  };

  const replaceSchedulesInFirestore = async (records) => {
    const normalizedRecords = records.map((record, index) => normalizeSchedule({ id: record.ID || `upload-${index}`, ...record }));
    const incomingIds = new Set(records.map((record, index) => record.ID || `SCH-${String(index + 1).padStart(4, '0')}`));
    const currentSnapshot = await getDocs(collection(db, 'schedules'));
    const deleteBatch = writeBatch(db);
    let deleteCount = 0;

    currentSnapshot.docs.forEach((scheduleDoc) => {
      if (!incomingIds.has(scheduleDoc.id)) {
        deleteBatch.delete(doc(db, 'schedules', scheduleDoc.id));
        deleteCount += 1;
      }
    });

    if (deleteCount > 0) {
      await deleteBatch.commit();
    }

    for (let index = 0; index < records.length; index += 400) {
      const batch = writeBatch(db);
      const chunk = records.slice(index, index + 400);

      chunk.forEach((record, chunkIndex) => {
        const absoluteIndex = index + chunkIndex;
        const id = record.ID || `SCH-${String(absoluteIndex + 1).padStart(4, '0')}`;
        batch.set(doc(db, 'schedules', id), record);
      });

      await batch.commit();
    }

    const sortedData = normalizedRecords.sort(sortSchedule);
    setSchedules(sortedData);
    saveCachedSchedules(sortedData);
    setSyncMessage('Routine updated from uploaded file.');

    return deleteCount;
  };

  const uploadRoutineFile = async (file) => {
    setUploadingRoutine(true);
    setUploadStatus(`Reading ${file.name}...`);

    try {
      const records = await parseScheduleFile(file);
      setUploadStatus(`Found ${records.length} routine entries. Uploading to Firebase...`);
      const deletedCount = await replaceSchedulesInFirestore(records);
      setUploadStatus(`Uploaded ${records.length} entries. Removed ${deletedCount} old entries.`);
    } catch (error) {
      const message = error?.message || 'Routine upload failed.';
      setUploadStatus(message);
      Alert.alert('Upload failed', message);
    } finally {
      setUploadingRoutine(false);
    }
  };

  const openRoutineFilePicker = () => {
    if (typeof document === 'undefined') {
      Alert.alert('Web upload needed', 'Excel upload inside the app is available from the web version for now. On phone, we will add document picker support in a later step.');
      return;
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.csv';
    input.onchange = () => {
      const file = input.files?.[0];

      if (file) {
        const message = 'This will update Firebase schedules from the selected file and remove schedule entries that are no longer in the file.';

        if (typeof window !== 'undefined' && window.confirm) {
          if (window.confirm(message)) {
            uploadRoutineFile(file);
          }
          return;
        }

        Alert.alert('Replace routine?', message, [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Upload', onPress: () => uploadRoutineFile(file) },
        ]);
      }
    };
    input.click();
  };

  const renderScheduleCard = ({ item }) => (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <Text selectable style={styles.subject}>{item.subject}</Text>
        <Text selectable style={styles.classType}>{item.classType}</Text>
      </View>

      <View style={styles.metaRow}>
        <Text selectable style={styles.metaText}>{item.day}</Text>
        {!!item.date && <Text selectable style={styles.metaText}>{item.date}</Text>}
      </View>

      <View style={styles.detailList}>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Time</Text>
          <Text selectable style={styles.detailValue}>{item.time}</Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Class</Text>
          <Text selectable style={styles.detailValue}>{item.classNo}</Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Room</Text>
          <Text selectable style={styles.detailValue}>{item.roomNo}</Text>
        </View>
      </View>

      <Text selectable style={styles.teacherName}>{item.teacherName}</Text>
    </View>
  );

  const renderList = (data, emptyText) => (
    <FlatList
      data={data}
      keyExtractor={(item) => item.id}
      renderItem={renderScheduleCard}
      scrollEnabled={false}
      ListEmptyComponent={<Text selectable style={styles.emptyText}>{emptyText}</Text>}
    />
  );

  const renderOptionRow = (options, value, onChange, formatLabel = (item) => item) => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.optionRow}>
      {options.map((option) => (
        <TouchableOpacity
          key={option}
          onPress={() => onChange(option)}
          style={[styles.optionButton, value === option && styles.activeOptionButton]}
        >
          <Text style={[styles.optionText, value === option && styles.activeOptionText]}>{formatLabel(option)}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );

  const renderTeacherSetup = () => (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>Who is using the app?</Text>
      <Text style={styles.panelCopy}>Enter your teacher name once. After that, this first page shows only your routine for today.</Text>
      <TextInput
        onChangeText={setTeacherDraft}
        placeholder="Type teacher name"
        style={styles.input}
        value={teacherDraft}
      />
      <TouchableOpacity onPress={() => saveTeacher()} style={styles.primaryButton}>
        <Text style={styles.primaryButtonText}>Show My Routine</Text>
      </TouchableOpacity>
      <Text style={styles.sectionLabel}>Or choose from routine</Text>
      <View style={styles.teacherChips}>
        {teacherNames.map((name) => (
          <TouchableOpacity key={name} onPress={() => saveTeacher(name)} style={styles.teacherChip}>
            <Text style={styles.teacherChipText}>{name}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  const renderMyRoutine = () => {
    if (!selectedTeacher) {
      return renderTeacherSetup();
    }

    return (
      <View style={styles.panel}>
        <View style={styles.sectionHeader}>
          <View>
            <Text selectable style={styles.panelTitle}>{selectedTeacher}</Text>
            <Text selectable style={styles.panelCopy}>Default is today, but you can move to previous or next routine days.</Text>
          </View>
          <TouchableOpacity onPress={() => setSelectedTeacher('')} style={styles.smallButton}>
            <Text style={styles.smallButtonText}>Change</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.dayControl}>
          <TouchableOpacity onPress={() => moveTeacherDay(-1)} style={styles.dayArrowButton}>
            <Text style={styles.dayArrowText}>Previous</Text>
          </TouchableOpacity>
          <View style={styles.selectedDayBox}>
            <Text selectable style={styles.selectedDayText}>{selectedDay}</Text>
            {selectedDay === todayName && <Text style={styles.todayBadge}>Today</Text>}
          </View>
          <TouchableOpacity onPress={() => moveTeacherDay(1)} style={styles.dayArrowButton}>
            <Text style={styles.dayArrowText}>Next</Text>
          </TouchableOpacity>
        </View>
        {renderOptionRow(teacherDayOptions, selectedDay, setSelectedDay)}
        {renderList(myRoutineSchedule, `No ${selectedDay} routine found for ${selectedTeacher}.`)}
      </View>
    );
  };

  const renderTeachers = () => (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>Teacher Lookup</Text>
      <Text style={styles.panelCopy}>Use this when you need to check another teacher's routine.</Text>
      <TextInput
        onChangeText={setTeacherLookup}
        placeholder="Search teacher name"
        style={styles.input}
        value={teacherLookup}
      />
      {renderList(teacherLookupSchedule, 'Type a teacher name to see matching routine entries.')}
    </View>
  );

  const renderStudents = () => (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>Student View</Text>
      <Text style={styles.panelCopy}>Choose a class to see that class routine for today.</Text>
      {renderOptionRow(classOptions, selectedClass, setSelectedClass, (option) => option === 'All' ? 'Choose class' : option)}
      {renderList(studentSchedule, selectedClass === 'All' ? 'Choose a class first.' : `No ${todayName} routine found for ${selectedClass}.`)}
    </View>
  );

  const renderClasses = () => (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>By Class</Text>
      <Text style={styles.panelCopy}>Class routines are mostly permanent. Use this section to review a whole class before edit/proxy work.</Text>
      {renderOptionRow(classOptions, selectedClass, setSelectedClass, (option) => option === 'All' ? 'Choose class' : option)}
      {renderList(classSchedule, selectedClass === 'All' ? 'Choose a class first.' : `No routine found for ${selectedClass}.`)}
    </View>
  );

  const renderRooms = () => (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>Rooms</Text>
      <Text style={styles.panelCopy}>Choose a room to see how it is being used.</Text>
      {renderOptionRow(roomOptions, selectedRoom, setSelectedRoom, (option) => option === 'All' ? 'Choose room' : `Room ${option}`)}
      {renderList(roomSchedule, selectedRoom === 'All' ? 'Choose a room first.' : `No routine found for room ${selectedRoom}.`)}
    </View>
  );

  const renderAdmin = () => (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>Admin Work</Text>
      <Text style={styles.panelCopy}>Update the full routine from a new Excel or CSV file. Edit, remove, makeup, and proxy tools will come next.</Text>
      <TouchableOpacity disabled={uploadingRoutine} onPress={openRoutineFilePicker} style={styles.uploadButton}>
        {uploadingRoutine ? <ActivityIndicator color="#fff" /> : <Text style={styles.uploadButtonText}>Upload Excel Routine</Text>}
      </TouchableOpacity>
      {!!uploadStatus && <Text selectable style={styles.uploadStatus}>{uploadStatus}</Text>}
      <View style={styles.adminGrid}>
        {['Add class', 'Edit class', 'Remove class', 'Assign proxy'].map((item) => (
          <View key={item} style={styles.adminAction}>
            <Text style={styles.adminActionText}>{item}</Text>
            <Text style={styles.adminStatus}>Next phase</Text>
          </View>
        ))}
      </View>
    </View>
  );

  const renderRoutineBuilder = () => (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>Routine Builder</Text>
      <Text style={styles.panelCopy}>
        Build the weekly routine day-by-day. Tap any slot to assign a teacher, subject, and room.
        Conflicts are highlighted automatically.
      </Text>
      <View style={{ marginTop: 14 }}>
        <RoutineBuilder schedules={schedules} onSaved={fetchSchedules} />
      </View>
    </View>
  );

  const renderActiveSection = () => {
    if (activeSection === 'My Routine') {
      return renderMyRoutine();
    }
    if (activeSection === 'Teachers') {
      return renderTeachers();
    }
    if (activeSection === 'Students') {
      return renderStudents();
    }
    if (activeSection === 'Classes') {
      return renderClasses();
    }
    if (activeSection === 'Rooms') {
      return renderRooms();
    }

    if (activeSection === 'Routine Builder') {
      return renderRoutineBuilder();
    }

    return renderAdmin();
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#1f6feb" />
        <Text selectable style={styles.loadingText}>{syncMessage}</Text>
      </View>
    );
  }

  if (!user) {
    return (
      <SafeAreaView style={styles.authScreen}>
        <ExpoStatusBar style="dark" />
        <View style={styles.loginBox}>
          <Text style={styles.brand}>DISS Routine</Text>
          <Text style={styles.tagline}>Teachers can continue as viewers. Admins should use email login.</Text>
          <TextInput
            autoCapitalize="none"
            keyboardType="email-address"
            onChangeText={setEmail}
            placeholder="Email"
            style={styles.input}
            value={email}
          />
          <TextInput
            onChangeText={setPassword}
            placeholder="Password"
            secureTextEntry
            style={styles.input}
            value={password}
          />
          <TouchableOpacity disabled={authLoading} onPress={handleLogin} style={styles.primaryButton}>
            {authLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Login</Text>}
          </TouchableOpacity>
          <TouchableOpacity disabled={authLoading} onPress={handleViewerLogin} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Continue as Viewer</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar barStyle="dark-content" />
      <ExpoStatusBar style="dark" />
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>DISS Routine</Text>
          <Text selectable style={styles.subtitle}>{syncMessage}</Text>
        </View>
        <TouchableOpacity onPress={handleLogout} style={styles.logoutButton}>
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sectionNav}>
          {sections.map((section) => (
            <TouchableOpacity
              key={section}
              onPress={() => setActiveSection(section)}
              style={[styles.sectionButton, activeSection === section && styles.activeSectionButton]}
            >
              <Text style={[styles.sectionButtonText, activeSection === section && styles.activeSectionButtonText]}>{section}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        {renderActiveSection()}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#eef3f8' },
  authScreen: { flex: 1, backgroundColor: '#eef3f8', justifyContent: 'center' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#eef3f8', padding: 24 },
  loadingText: { marginTop: 12, color: '#51606f', textAlign: 'center' },
  loginBox: { width: '86%', maxWidth: 420, alignSelf: 'center' },
  brand: { fontSize: 38, fontWeight: '800', color: '#174ea6', textAlign: 'center' },
  tagline: { fontSize: 15, color: '#51606f', textAlign: 'center', marginTop: 8, marginBottom: 28 },
  input: {
    backgroundColor: '#fff',
    borderColor: '#c8d4e2',
    borderRadius: 8,
    borderWidth: 1,
    fontSize: 16,
    marginTop: 12,
    padding: 14,
  },
  primaryButton: { backgroundColor: '#174ea6', borderRadius: 8, alignItems: 'center', marginTop: 12, padding: 16 },
  primaryButtonText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  secondaryButton: { alignItems: 'center', backgroundColor: '#edf2f7', borderRadius: 8, marginTop: 10, padding: 15 },
  secondaryButtonText: { color: '#174ea6', fontSize: 15, fontWeight: '800' },
  header: {
    alignItems: 'center',
    backgroundColor: '#fff',
    borderBottomColor: '#d7e1ec',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  headerText: { flex: 1, paddingRight: 10 },
  title: { color: '#174ea6', fontSize: 22, fontWeight: '800' },
  subtitle: { color: '#667789', fontSize: 12, marginTop: 2 },
  logoutButton: { backgroundColor: '#c5221f', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  logoutText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  content: { gap: 12, padding: 14, paddingBottom: 32 },
  sectionNav: { gap: 8 },
  sectionButton: { backgroundColor: '#fff', borderColor: '#d8e2ed', borderRadius: 8, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10 },
  activeSectionButton: { backgroundColor: '#174ea6', borderColor: '#174ea6' },
  sectionButtonText: { color: '#46586b', fontSize: 13, fontWeight: '800' },
  activeSectionButtonText: { color: '#fff' },
  panel: { backgroundColor: '#fff', borderColor: '#d8e2ed', borderRadius: 8, borderWidth: 1, padding: 14 },
  sectionHeader: { alignItems: 'flex-start', flexDirection: 'row', gap: 10, justifyContent: 'space-between' },
  panelTitle: { color: '#1f2d3d', fontSize: 20, fontWeight: '800' },
  panelCopy: { color: '#607184', fontSize: 13, lineHeight: 19, marginTop: 4 },
  sectionLabel: { color: '#6b7b8c', fontSize: 11, fontWeight: '800', marginTop: 16, textTransform: 'uppercase' },
  teacherChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  teacherChip: { backgroundColor: '#edf2f7', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  teacherChipText: { color: '#2f4052', fontSize: 13, fontWeight: '700' },
  smallButton: { backgroundColor: '#edf2f7', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  smallButtonText: { color: '#174ea6', fontSize: 12, fontWeight: '800' },
  dayControl: { alignItems: 'center', flexDirection: 'row', gap: 8, justifyContent: 'space-between', marginTop: 14 },
  dayArrowButton: { alignItems: 'center', backgroundColor: '#edf2f7', borderRadius: 8, minWidth: 82, paddingHorizontal: 10, paddingVertical: 10 },
  dayArrowText: { color: '#174ea6', fontSize: 12, fontWeight: '800' },
  selectedDayBox: { alignItems: 'center', flex: 1 },
  selectedDayText: { color: '#1f2d3d', fontSize: 18, fontWeight: '800' },
  todayBadge: { color: '#d93025', fontSize: 11, fontWeight: '800', marginTop: 2, textTransform: 'uppercase' },
  optionRow: { gap: 8, paddingVertical: 12 },
  optionButton: { backgroundColor: '#edf2f7', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  activeOptionButton: { backgroundColor: '#174ea6' },
  optionText: { color: '#4d5d6c', fontSize: 12, fontWeight: '800' },
  activeOptionText: { color: '#fff' },
  card: {
    backgroundColor: '#fff',
    borderColor: '#dce5ef',
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 10,
    padding: 14,
  },
  cardTop: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  subject: { color: '#1f2d3d', flex: 1, fontSize: 17, fontWeight: '800' },
  classType: { backgroundColor: '#feeceb', borderRadius: 8, color: '#d93025', fontSize: 12, fontWeight: '800', paddingHorizontal: 8, paddingVertical: 4 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 6 },
  metaText: { color: '#667789', fontSize: 12, fontWeight: '700' },
  detailList: { backgroundColor: '#f7f9fc', borderRadius: 8, marginTop: 10, paddingHorizontal: 12, paddingVertical: 8 },
  detailRow: {
    alignItems: 'center',
    borderBottomColor: '#e3eaf2',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 34,
  },
  detailLabel: { color: '#738496', fontSize: 11, fontWeight: '800', paddingRight: 12, textTransform: 'uppercase', width: 64 },
  detailValue: { color: '#1f2d3d', flex: 1, fontSize: 14, fontWeight: '700', textAlign: 'right' },
  teacherName: { color: '#1f2d3d', fontSize: 14, fontWeight: '800', marginTop: 10 },
  emptyText: { color: '#667789', lineHeight: 20, marginTop: 16, textAlign: 'center' },
  adminGrid: { gap: 10, marginTop: 12 },
  uploadButton: { alignItems: 'center', backgroundColor: '#174ea6', borderRadius: 8, marginTop: 14, padding: 15 },
  uploadButtonText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  uploadStatus: { color: '#46586b', fontSize: 13, lineHeight: 19, marginTop: 10 },
  adminAction: { backgroundColor: '#f7f9fc', borderColor: '#e0e7f0', borderRadius: 8, borderWidth: 1, padding: 12 },
  adminActionText: { color: '#1f2d3d', fontSize: 15, fontWeight: '800' },
  adminStatus: { color: '#667789', fontSize: 12, fontWeight: '700', marginTop: 4 },
});