const express = require('express');
const fs = require('fs');
const csv = require('csv-parser');
const cors = require('cors');
const path = require('path');

const app = express();
const port = 3000;
const PAGE_SIZE = 20;

// --- Global data storage with caching for serverless ---
// Use global scope to cache data across requests in warm instances
global.isDataReady = global.isDataReady || false;
global.isLoading = global.isLoading || false;
global.interactions = global.interactions || [];
global.uniqueDrugNames = global.uniqueDrugNames || new Set();
global.drugDetails = global.drugDetails || [];
global.contraindicationData = global.contraindicationData || [];
global.contraindicationTerms = global.contraindicationTerms || new Set();
global.allFilterData = global.allFilterData || {};

// Local references for easier access
let interactions = global.interactions;
let uniqueDrugNames = global.uniqueDrugNames;
let drugDetails = global.drugDetails;
let contraindicationData = global.contraindicationData;
let contraindicationTerms = global.contraindicationTerms;
let allFilterData = global.allFilterData;
// -------

app.use(cors());

// --- NEW: Serve static files like style.css and navbar.html ---
app.use(express.static(path.join(__dirname)));

// --- LOADER 1: Your interactions CSV ---
fs.createReadStream('drug-data.csv')
  .pipe(csv())
  .on('data', (row) => {
    interactions.push(row);
    if (row['Drug 1']) uniqueDrugNames.add(row['Drug 1'].trim().toLowerCase());
    if (row['Drug 2']) uniqueDrugNames.add(row['Drug 2'].trim().toLowerCase());
  })
  .on('end', () => {
    uniqueDrugNames = [...uniqueDrugNames].sort();
    console.log(`drug-data.csv successfully loaded. ${interactions.length} records found.`);
    checkIfServerReady();
  });

// --- LOADER 2: Your drug type CSV ---
fs.createReadStream('Drugs-Type.csv')
  .pipe(csv())
  .on('data', (row) => {
    if (row.Type) {
      drugDetails.push(row);

      const type = (row.Type || '').toLowerCase().trim();
      if (!type) return;

      if (!allFilterData[type]) {
        allFilterData[type] = {
          brandNames: new Set(),
          genericNames: new Set(),
          manufacturers: new Set()
        };
      }

      const addToSet = (set, value) => {
        if (value && value.toLowerCase() !== 'false') {
          set.add(value.trim());
        }
      };

      addToSet(allFilterData[type].brandNames, row['Brand-Name']);
      addToSet(allFilterData[type].genericNames, row['GenericName']);
      addToSet(allFilterData[type].manufacturers, row['Manufacturer']);
    }
  })
  .on('end', () => {
    console.log(`Drugs-Type.csv successfully loaded. ${drugDetails.length} records found.`);
    for (const type in allFilterData) {
      allFilterData[type].brandNames = [...allFilterData[type].brandNames].sort();
      allFilterData[type].genericNames = [...allFilterData[type].genericNames].sort();
      allFilterData[type].manufacturers = [...allFilterData[type].manufacturers].sort();
    }
    console.log(`Filter data processed for ${Object.keys(allFilterData).length} types.`);
    checkIfServerReady();
  });

// --- LOADER 3: Your contraindication CSV ---
fs.createReadStream('drug-contraindication.csv')
  .pipe(csv())
  .on('data', (row) => {
    contraindicationData.push(row);

    const terms = (row.contraindications || '').toLowerCase();

    const splitTerms = terms.split(/[,;]/);

    splitTerms.forEach(term => {
      const cleanedTerm = term.trim();
      if (cleanedTerm && cleanedTerm.length > 2 && cleanedTerm !== 'false') {
        contraindicationTerms.add(cleanedTerm);
      }
    });
  })
  .on('end', () => {
    console.log(`drug-contraindication.csv successfully loaded. ${contraindicationData.length} records found.`);
    contraindicationTerms = [...contraindicationTerms].sort();
    console.log(`Found ${contraindicationTerms.length} unique contraindication terms.`);
    checkIfServerReady();
  });

// --- Helper to log server ready ---
let filesLoaded = 0;
function checkIfServerReady() {
  filesLoaded++;
  if (filesLoaded === 3) { // Now waiting for 3 files
    global.isDataReady = true;
    global.isLoading = false;
    console.log(`All CSV files loaded. Server is ready!`);
    console.log(`Open http://localhost:${port} in your browser.`);
  }
}

// --- Load CSV files only if not already loaded (for serverless caching) ---
if (!global.isDataReady && !global.isLoading) {
  global.isLoading = true;
  console.log('Starting CSV data load...');

  // CSV loading code will execute from the existing code below
}

// --- Health Check Endpoint ---
app.get('/health', (req, res) => {
  res.json({
    status: global.isDataReady ? 'ready' : 'loading',
    isLoading: global.isLoading,
    dataLoaded: {
      interactions: global.interactions.length,
      drugDetails: global.drugDetails.length,
      contraindicationData: global.contraindicationData.length,
      uniqueDrugNames: Array.isArray(global.uniqueDrugNames) ? global.uniqueDrugNames.length : global.uniqueDrugNames.size,
      contraindicationTerms: Array.isArray(global.contraindicationTerms) ? global.contraindicationTerms.length : global.contraindicationTerms.size
    }
  });
});

// --- All APIs ---

app.get('/search-drug', (req, res) => {
  const term = (req.query.term || '').toLowerCase();
  if (!term) {
    return res.json([]);
  }
  const results = uniqueDrugNames.filter(name =>
    name.startsWith(term)
  );
  res.json(results.slice(0, 10));
});

app.get('/check-interactions', (req, res) => {
  const drugQuery = req.query.drugs;
  if (!drugQuery) {
    return res.status(400).json({ error: 'No drugs provided.' });
  }
  const drugList = drugQuery.split(',').map(d => d.trim().toLowerCase());
  if (drugList.length < 2) {
    return res.status(400).json({ error: 'Please provide at least two drugs.' });
  }
  let foundInteractions = [];
  for (let i = 0; i < drugList.length; i++) {
    for (let j = i + 1; j < drugList.length; j++) {
      const drugA = drugList[i];
      const drugB = drugList[j];
      const match = interactions.find(row => {
        const drug1_csv = row['Drug 1'] ? row['Drug 1'].toLowerCase() : '';
        const drug2_csv = row['Drug 2'] ? row['Drug 2'].toLowerCase() : '';
        return (drug1_csv === drugA && drug2_csv === drugB) ||
          (drug1_csv === drugB && drug2_csv === drugA);
      });
      if (match) {
        foundInteractions.push({
          drugs: [drugA, drugB],
          description: match['Interaction Description']
        });
      }
    }
  }
  res.json(foundInteractions);
});

app.get('/api/drug-filters', (req, res) => {
  const drugType = (req.query.type || '').toLowerCase();
  if (allFilterData[drugType]) {
    res.json(allFilterData[drugType]);
  } else {
    res.json({ brandNames: [], genericNames: [], manufacturers: [] });
  }
});

app.get('/api/drugs-by-type', (req, res) => {
  const drugType = (req.query.type || '').toLowerCase();
  const brandName = (req.query.brandName || '').toLowerCase();
  const genericName = (req.query.genericName || '').toLowerCase();
  const manufacturer = (req.query.manufacturer || '').toLowerCase();
  const page = parseInt(req.query.page || '1', 10);
  if (!drugType) {
    return res.status(400).json({ error: 'No drug type provided.' });
  }
  let filteredResults = drugDetails.filter(drug => {
    if ((drug.Type || '').toLowerCase().trim() !== drugType) {
      return false;
    }
    const check = (csvValue, filterValue) => {
      const csvData = (csvValue || '').toLowerCase().trim();
      return !filterValue || csvData === filterValue;
    };
    if (!check(drug['Brand-Name'], brandName)) return false;
    if (!check(drug['GenericName'], genericName)) return false;
    if (!check(drug['Manufacturer'], manufacturer)) return false;
    return true;
  });
  const totalMatches = filteredResults.length;
  const startIndex = (page - 1) * PAGE_SIZE;
  const endIndex = page * PAGE_SIZE;
  const paginatedDrugs = filteredResults.slice(startIndex, endIndex);
  const results = paginatedDrugs.map(drug => ({
    brandName: drug['Brand-Name'],
    genericName: drug['GenericName'],
    manufacturer: drug['Manufacturer']
  }));
  res.json({
    drugs: results,
    totalMatches: totalMatches,
    currentPage: page,
    pageSize: PAGE_SIZE
  });
});

app.get('/api/search-contraindications', (req, res) => {
  const contraTerm = (req.query.contra || '').toLowerCase().trim();
  const drugName = (req.query.drug || '').toLowerCase().trim();
  if (contraTerm.length < 3 || drugName.length < 2) {
    return res.json([]);
  }
  const results = contraindicationData
    .filter(row => {
      const contraMatch = (row.contraindications || '').toLowerCase().includes(contraTerm);
      const drugMatch = (row.drug_name || '').toLowerCase() === drugName;
      return contraMatch && drugMatch;
    })
    .map(row => ({
      drug_name: row.drug_name,
      manufacturer: row.manufacturer,
      indications: row.indications,
      side_effects: row.side_effects,
      warnings: row.warnings
    }));
  res.json(results);
});

app.get('/api/contraindication-suggestions', (req, res) => {
  const term = (req.query.term || '').toLowerCase().trim();
  if (term.length < 2) {
    return res.json([]);
  }
  const results = contraindicationTerms.filter(t => t.startsWith(term));
  res.json(results.slice(0, 10));
});

app.get('/api/drug-suggestions-by-contra', (req, res) => {
  const contraTerm = (req.query.contra || '').toLowerCase().trim();
  const drugTerm = (req.query.term || '').toLowerCase().trim();
  if (contraTerm.length < 2 || drugTerm.length < 2) {
    return res.json([]);
  }
  const matchingDrugs = new Set();
  contraindicationData.forEach(row => {
    const drugName = (row.drug_name || '');
    const contraMatch = (row.contraindications || '').toLowerCase().includes(contraTerm);
    const drugMatch = drugName.toLowerCase().startsWith(drugTerm);
    if (contraMatch && drugMatch) {
      matchingDrugs.add(drugName);
    }
  });
  res.json([...matchingDrugs].sort().slice(0, 10));
});


// --- UPDATED: Code to serve your HTML pages ---

// 1. Home Page (index.html) - This is now the NEW homepage
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// 2. NEW: Drug Interactions Page (Your old homepage)
app.get('/interactions.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'interactions.html'));
});

// 3. About Page (about.html)
app.get('/about.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'about.html'));
});

// 4. Drugs by Type Page (drugs.html)
app.get('/drugs.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'drugs.html'));
});

// 5. Contraindications Page
app.get('/contraindications.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'contraindications.html'));
});

// --- Start the server (only for local development) ---
if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`Server process started. Loading CSV data...`);
  });
}

// Export the app for Vercel serverless deployment
module.exports = app;