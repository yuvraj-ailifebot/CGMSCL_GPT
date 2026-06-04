/**
 * Excel Generator Utility
 * Generates Excel files from tabular data on the frontend
 * Uses the locally installed 'xlsx' npm package (no CDN required)
 */
import * as XLSX from 'xlsx';

/**
 * Convert array of objects or arrays to Excel file (XLSX format)
 * @param {Array} data - Array of objects or arrays with data
 * @param {string} filename - Name of the file to download
 * @param {Array} providedHeaders - Optional column headers (if data is array of arrays)
 */
export async function generateExcelFromData(data, filename = 'CGMSCL_Query_Results.xlsx', providedHeaders = null) {
  try {
    if (!data || !Array.isArray(data) || data.length === 0) {
      throw new Error('No data provided or data is empty');
    }

    let headers = [];
    let worksheetData = [];

    const firstItem = data[0];
    const isArrayOfArrays = Array.isArray(firstItem);

    if (isArrayOfArrays) {
      if (providedHeaders && Array.isArray(providedHeaders) && providedHeaders.length > 0) {
        headers = providedHeaders.map(h => String(h || 'Column'));
        worksheetData = [headers];
        data.forEach(row => {
          const paddedRow = headers.map((_, idx) => {
            const val = row && row[idx] !== undefined ? row[idx] : '';
            return val === null || val === undefined ? '' : val;
          });
          worksheetData.push(paddedRow);
        });
      } else {
        const numColumns = firstItem ? firstItem.length : 0;
        headers = Array.from({ length: numColumns }, (_, idx) => `Column ${idx + 1}`);
        worksheetData = [headers];
        data.forEach(row => {
          if (Array.isArray(row)) {
            const paddedRow = headers.map((_, idx) => {
              const val = row && row[idx] !== undefined ? row[idx] : '';
              return val === null || val === undefined ? '' : String(val);
            });
            worksheetData.push(paddedRow);
          }
        });
      }
    } else {
      // Array of objects
      headers = Object.keys(firstItem);
      worksheetData.push(headers);
      data.forEach(row => {
        const values = headers.map(header => {
          const value = row[header];
          return value === null || value === undefined ? '' : value;
        });
        worksheetData.push(values);
      });
    }

    // Build workbook
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(worksheetData);

    // Auto-width columns
    const colWidths = headers.map((header, colIndex) => {
      let maxLength = String(header).length;
      for (let rowIndex = 1; rowIndex < worksheetData.length; rowIndex++) {
        const cellValue = worksheetData[rowIndex][colIndex];
        if (cellValue !== null && cellValue !== undefined) {
          const cellLength = String(cellValue).length;
          if (cellLength > maxLength) maxLength = cellLength;
        }
      }
      return { wch: Math.min(Math.max(maxLength + 2, 10), 50) };
    });
    ws['!cols'] = colWidths;

    XLSX.utils.book_append_sheet(wb, ws, 'Data');

    const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);

    return true;
  } catch (error) {
    console.error('Error generating Excel file:', error);
    throw error;
  }
}

/**
 * Generate Excel from response text (extracts markdown tables if present)
 */
export async function generateExcelFromResponse(responseText, filename = 'CGMSCL_Query_Results.xlsx') {
  try {
    const lines = responseText.split('\n');
    const data = [];
    let headers = null;
    let inTable = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.match(/^\|[\s\-|:]+\|$/)) { inTable = true; continue; }
      if (line.startsWith('|') && line.endsWith('|')) {
        const cells = line.split('|').map(c => c.trim()).filter(c => c);
        if (!headers) {
          headers = cells;
        } else {
          const row = {};
          headers.forEach((header, idx) => { row[header] = cells[idx] || ''; });
          data.push(row);
        }
        inTable = true;
      } else if (inTable && line && !line.startsWith('|')) {
        break;
      }
    }

    if (data.length > 0) return await generateExcelFromData(data, filename);

    // Fallback: simple text export
    const simpleData = [{ 'Response': responseText }];
    return await generateExcelFromData(simpleData, filename);
  } catch (error) {
    console.error('Error generating Excel from response:', error);
    throw error;
  }
}
