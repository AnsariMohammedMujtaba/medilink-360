const fs = require('fs');
const csv = require('csv-parser');
const path = require('path');

console.log('Starting CSV to JSON conversion...\n');

// Create data directory if it doesn't exist
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir);
    console.log('✓ Created data/ directory\n');
}

// Conversion function
function convertCSVtoJSON(csvFile, jsonFile, description) {
    return new Promise((resolve, reject) => {
        const results = [];
        const startTime = Date.now();

        console.log(`Converting ${csvFile}...`);

        fs.createReadStream(csvFile)
            .pipe(csv())
            .on('data', (data) => results.push(data))
            .on('end', () => {
                const jsonPath = path.join(dataDir, jsonFile);
                fs.writeFileSync(jsonPath, JSON.stringify(results, null, 0)); // Minified

                const duration = ((Date.now() - startTime) / 1000).toFixed(2);
                const size = (fs.statSync(jsonPath).size / 1024 / 1024).toFixed(2);

                console.log(`✓ ${description}`);
                console.log(`  - Records: ${results.length.toLocaleString()}`);
                console.log(`  - Size: ${size} MB`);
                console.log(`  - Time: ${duration}s\n`);

                resolve(results.length);
            })
            .on('error', reject);
    });
}

// Convert all CSV files
async function convertAll() {
    try {
        await convertCSVtoJSON('drug-data.csv', 'interactions.json', 'Drug interactions');
        await convertCSVtoJSON('Drugs-Type.csv', 'drug-details.json', 'Drug details');
        await convertCSVtoJSON('drug-contraindication.csv', 'contraindications.json', 'Contraindications');

        console.log('✅ All CSV files converted successfully!');
        console.log('\nNext steps:');
        console.log('1. Update index.js to load JSON files');
        console.log('2. Test locally');
        console.log('3. Push to GitHub and deploy\n');
    } catch (error) {
        console.error('❌ Error during conversion:', error);
        process.exit(1);
    }
}

convertAll();
