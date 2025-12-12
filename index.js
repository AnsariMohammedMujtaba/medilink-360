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

// --- Serve static files like style.css and navbar.html ---
app.use(express.static(path.join(__dirname)));

// --- Load data from JSON files (much faster than CSV) ---
// Only load if not already loaded (for serverless caching)
if (!global.isDataReady && !global.isLoading) {
  global.isLoading = true;
  console.log('Loading data from JSON files...');

  try {
    const startTime = Date.now();

    // Load interactions
    const interactionsData = JSON.parse(
      fs.readFileSync(path.join(__dirname, 'data', 'interactions.json'), 'utf8')
    );
    global.interactions = interactionsData;
    interactions = global.interactions;

    // Extract unique drug names
    const drugNamesSet = new Set();
    interactionsData.forEach(row => {
      if (row['Drug 1']) drugNamesSet.add(row['Drug 1'].trim().toLowerCase());
      if (row['Drug 2']) drugNamesSet.add(row['Drug 2'].trim().toLowerCase());
    });
    global.uniqueDrugNames = [...drugNamesSet].sort();
    uniqueDrugNames = global.uniqueDrugNames;
    console.log(`✓ Loaded ${interactions.length} drug interactions`);

    // Load drug details
    const drugDetailsData = JSON.parse(
      fs.readFileSync(path.join(__dirname, 'data', 'drug-details.json'), 'utf8')
    );
    global.drugDetails = drugDetailsData;
    drugDetails = global.drugDetails;

    // Process filter data
    const filterData = {};
    drugDetailsData.forEach(row => {
      if (!row.Type) return;

      const type = row.Type.toLowerCase().trim();
      if (!type) return;

      if (!filterData[type]) {
        filterData[type] = {
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

      addToSet(filterData[type].brandNames, row['Brand-Name']);
      addToSet(filterData[type].genericNames, row['GenericName']);
      addToSet(filterData[type].manufacturers, row['Manufacturer']);
    });

    // Convert Sets to sorted arrays
    for (const type in filterData) {
      filterData[type].brandNames = [...filterData[type].brandNames].sort();
      filterData[type].genericNames = [...filterData[type].genericNames].sort();
      filterData[type].manufacturers = [...filterData[type].manufacturers].sort();
    }
    global.allFilterData = filterData;
    allFilterData = global.allFilterData;
    console.log(`✓ Loaded ${drugDetails.length} drug details, ${Object.keys(allFilterData).length} types`);

    // Load contraindications
    const contraindicationsData = JSON.parse(
      fs.readFileSync(path.join(__dirname, 'data', 'contraindications.json'), 'utf8')
    );
    global.contraindicationData = contraindicationsData;
    contraindicationData = global.contraindicationData;

    // Extract contraindication terms
    const termsSet = new Set();
    contraindicationsData.forEach(row => {
      const terms = (row.contraindications || '').toLowerCase();
      const splitTerms = terms.split(/[,;]/);
      splitTerms.forEach(term => {
        const cleanedTerm = term.trim();
        if (cleanedTerm && cleanedTerm.length > 2 && cleanedTerm !== 'false') {
          termsSet.add(cleanedTerm);
        }
      });
    });
    global.contraindicationTerms = [...termsSet].sort();
    contraindicationTerms = global.contraindicationTerms;
    console.log(`✓ Loaded ${contraindicationData.length} contraindications, ${contraindicationTerms.length} unique terms`);

    global.isDataReady = true;
    global.isLoading = false;

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✅ All data loaded successfully in ${duration}s`);
    console.log(`Open http://localhost:${port} in your browser.`);

  } catch (error) {
    console.error('❌ Error loading JSON files:', error);
    global.isLoading = false;
  }
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

// Serve navbar.html explicitly (needed for Vercel)
app.get('/navbar.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'navbar.html'));
});

// Serve style.css explicitly (needed for Vercel)
app.get('/style.css', (req, res) => {
  res.sendFile(path.join(__dirname, 'style.css'));
});

// Serve navbar.js explicitly (needed for Vercel)
app.get('/navbar.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'navbar.js'));
});

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