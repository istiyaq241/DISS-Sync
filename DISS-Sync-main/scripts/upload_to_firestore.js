const fs = require('fs');
const path = require('path');
const { initializeApp } = require('firebase/app');
const { getAuth, signInWithEmailAndPassword } = require('firebase/auth');
const {
  collection,
  deleteDoc,
  doc,
  getDocs,
  getFirestore,
  writeBatch,
} = require('firebase/firestore');

const DEFAULT_CONFIG = {
  firebaseConfig: {
    apiKey: 'AIzaSyD0ODAyvsJD1_1b4tlOnEk7MS0Gc_lev2k',
    authDomain: 'diss-sync.firebaseapp.com',
    projectId: 'diss-sync',
    storageBucket: 'diss-sync.firebasestorage.app',
    messagingSenderId: '1072940846539',
    appId: '1:1072940846539:web:75bd59d7143a58cd8e3a4e',
  },
  collectionName: 'schedules',
};

const parseArgs = () => {
  const args = {
    dataPath: path.join(process.cwd(), 'data.json'),
    configPath: path.join(process.cwd(), 'scripts', 'firebase_admin_config.local.json'),
    dryRun: false,
    replace: false,
  };

  process.argv.slice(2).forEach((arg) => {
    if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--replace') {
      args.replace = true;
    } else if (arg.startsWith('--config=')) {
      args.configPath = path.resolve(arg.replace('--config=', ''));
    } else if (arg.startsWith('--data=')) {
      args.dataPath = path.resolve(arg.replace('--data=', ''));
    } else {
      args.dataPath = path.resolve(arg);
    }
  });

  return args;
};

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));

const readConfig = (configPath) => {
  const fileConfig = fs.existsSync(configPath) ? readJson(configPath) : {};

  return {
    ...DEFAULT_CONFIG,
    ...fileConfig,
    firebaseConfig: {
      ...DEFAULT_CONFIG.firebaseConfig,
      ...(fileConfig.firebaseConfig || {}),
    },
    adminEmail: process.env.DISS_FIREBASE_EMAIL || fileConfig.adminEmail,
    adminPassword: process.env.DISS_FIREBASE_PASSWORD || fileConfig.adminPassword,
  };
};

const chunkRecords = (records, size) => {
  const chunks = [];

  for (let index = 0; index < records.length; index += size) {
    chunks.push(records.slice(index, index + size));
  }

  return chunks;
};

const getRecordId = (record, index) => {
  return record.ID || record.id || `schedule-${String(index + 1).padStart(4, '0')}`;
};

const uploadRecords = async ({ db, records, collectionName }) => {
  const chunks = chunkRecords(records, 400);

  for (const chunk of chunks) {
    const batch = writeBatch(db);

    chunk.forEach((record, index) => {
      const id = getRecordId(record, index);
      batch.set(doc(db, collectionName, id), record);
    });

    await batch.commit();
  }
};

const deleteMissingRecords = async ({ db, records, collectionName }) => {
  const incomingIds = new Set(records.map(getRecordId));
  const snapshot = await getDocs(collection(db, collectionName));
  const deletions = snapshot.docs.filter((document) => !incomingIds.has(document.id));

  for (const document of deletions) {
    await deleteDoc(doc(db, collectionName, document.id));
  }

  return deletions.length;
};

const upload = async () => {
  const args = parseArgs();
  const config = readConfig(args.configPath);
  const records = readJson(args.dataPath);

  if (!Array.isArray(records)) {
    throw new Error('Data file must contain a JSON array.');
  }

  console.log(`Data file: ${args.dataPath}`);
  console.log(`Collection: ${config.collectionName}`);
  console.log(`Records: ${records.length}`);

  if (args.dryRun) {
    console.log('Dry run only. No Firebase data was changed.');
    return;
  }

  if (!config.adminEmail || !config.adminPassword) {
    throw new Error('Set adminEmail/adminPassword in scripts/firebase_admin_config.local.json or use DISS_FIREBASE_EMAIL and DISS_FIREBASE_PASSWORD.');
  }

  const app = initializeApp(config.firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);

  await signInWithEmailAndPassword(auth, config.adminEmail, config.adminPassword);
  await uploadRecords({ db, records, collectionName: config.collectionName });

  let deletedCount = 0;
  if (args.replace) {
    deletedCount = await deleteMissingRecords({ db, records, collectionName: config.collectionName });
  }

  console.log(`Uploaded ${records.length} schedule records to Firestore.`);
  if (args.replace) {
    console.log(`Removed ${deletedCount} old records that were not in the new file.`);
  }
};

upload().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
