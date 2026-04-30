/**
 * Response Normalizer Utility
 * Handles transformation of various API response formats (AWS, OCI) 
 * into a consistent internal format for the UI.
 */

function unwrapApiResponse(data) {
  if (!data || typeof data !== 'object') {
    return data;
  }

  let normalized = data;

  for (let index = 0; index < 2; index += 1) {
    if (!normalized || typeof normalized !== 'object' || !('body' in normalized)) {
      break;
    }

    const { body } = normalized;

    if (typeof body === 'string') {
      try {
        const parsedBody = JSON.parse(body);
        normalized = {
          ...normalized,
          ...parsedBody
        };
      } catch {
        break;
      }
    } else if (body && typeof body === 'object') {
      normalized = {
        ...normalized,
        ...body
      };
    } else {
      break;
    }
  }

  return normalized;
}

/**
 * Normalizes AWS API responses
 * @param {Object} data - Raw response data from AWS API
 * @returns {Object} Normalized data object
 */
export function normalizeAWSResponse(data) {
  if (!data || typeof data !== 'object') return data;

  let normalized = { ...unwrapApiResponse(data) };
  const backendDetailMessage =
    normalized.data?.detail?.message ||
    normalized.detail?.message ||
    normalized.error?.message ||
    normalized.data?.message ||
    null;

  // Map sql -> sql_query
  if (normalized.sql && !normalized.sql_query) {
    normalized.sql_query = normalized.sql;
  }
  
  // Map query -> title if title is missing
  if (normalized.query && !normalized.title) {
    normalized.title = normalized.query;
  }
  
  // Extract data structure from AWS response format: data.result.{columns, rows}
  if (normalized.data?.result) {
    normalized.rows = normalized.data.result.rows;
    normalized.columns = normalized.data.result.columns;
    normalized.success = normalized.data.success;
    normalized.row_count = normalized.data.result.row_count;
    
    // Debug logging for AWS response
    console.log('AWS Response normalization:', {
      hasRows: Array.isArray(normalized.rows),
      rowsLength: normalized.rows?.length || 0,
      hasColumns: Array.isArray(normalized.columns),
      columnsLength: normalized.columns?.length || 0,
      rowCount: normalized.row_count
    });
  } else {
    // Debug: log if data.result is missing
    console.log('AWS Response - data.result not found:', {
      hasData: !!normalized.data,
      dataKeys: normalized.data ? Object.keys(normalized.data) : []
    });
  }

  // Set response message if available
  if (normalized.message && !normalized.response) {
    normalized.response = normalized.message;
  }

  if (backendDetailMessage) {
    normalized.error_message = backendDetailMessage;
  } else if (!normalized.response && (normalized.success === true || normalized.data?.success === true)) {
    normalized.response = 'Query executed successfully.';
  }

  // Auto-generate visualization if missing
  if (!normalized.visualization) {
    const rows = normalized.rows || normalized.data?.result?.rows;
    const columns = normalized.columns || normalized.data?.result?.columns;
    
    if (Array.isArray(rows) && rows.length > 0 && Array.isArray(columns) && columns.length > 0) {
      // Ensure first column exists and is valid
      const firstColumn = columns[0];
      if (firstColumn && firstColumn.trim() !== '') {
        // Find numeric column for Y axis (skip first column usually labels)
        let numericColIndex = -1;
        for (let i = 1; i < columns.length; i++) {
          const sampleVal = Array.isArray(rows[0]) ? rows[0][i] : rows[0][columns[i]];
          if (typeof sampleVal === 'number' || (typeof sampleVal === 'string' && !isNaN(parseFloat(sampleVal)))) {
            numericColIndex = i;
            break;
          }
        }

        if (numericColIndex !== -1 && columns[numericColIndex]) {
          normalized.visualization = {
            chartType: 'bar',
            xAxis: firstColumn,
            yAxis: columns[numericColIndex],
            title: normalized.title || 'Data Visualization'
          };
        }
      }
    }
  }
  
  // Map other rich fields with fallbacks
  normalized.analysis = normalized.analysis || normalized.data?.analysis || null;
  
  // Generate a basic analysis if missing but we have rows and a query
  if (!normalized.analysis && normalized.rows && normalized.rows.length > 0 && normalized.query) {
    normalized.analysis = `Based on your request regarding "${normalized.query}", I have retrieved the following ${normalized.rows.length} ${normalized.rows.length === 1 ? 'result' : 'results'}.`;
  } else if (!normalized.analysis && normalized.rows && normalized.rows.length > 0) {
    normalized.analysis = `I found ${normalized.rows.length} ${normalized.rows.length === 1 ? 'record' : 'records'} matching your query.`;
  }

  normalized.insights = normalized.insights || normalized.KeyInformation || normalized.key_information || normalized.data?.insights || null;
  normalized.insightsHeader = normalized.insightsHeader || ((normalized.KeyInformation || normalized.key_information) ? 'Key Information' : 'Key Insights');
  normalized.title = normalized.title || normalized.header || normalized.data?.title || null;
  normalized.subtitle = normalized.subtitle || normalized.subheader || normalized.data?.subtitle || null;

  // Final normalization of sql_query
  normalized.sql_query = normalized.sql_query || normalized.sql || (normalized.data && (normalized.data.sql || normalized.data.sql_query)) || null;

  return normalized;
}

/**
 * Normalizes OCI API responses
 * @param {Object} data - Raw response data from OCI API
 * @returns {Object} Normalized data object
 */
export function normalizeOCIResponse(data) {
  if (!data || typeof data !== 'object') return data;

  let normalized = { ...unwrapApiResponse(data) };
  const backendDetailMessage =
    normalized.data?.detail?.message ||
    normalized.detail?.message ||
    normalized.error?.message ||
    normalized.data?.message ||
    null;

  // 1. Handle stringified JSON results in 'response' field
  if (typeof normalized.response === 'string' && normalized.response.includes('Results:')) {
    const resultsIndex = normalized.response.indexOf('Results:');
    const preResultsText = normalized.response.substring(0, resultsIndex)
      .replace(/Query executed successfully\.?\s*/i, '')
      .trim();
    
    const match = normalized.response.match(/Results:\s*(\{.*\}|\[.*\])/s);
    if (match && match[1]) {
      try {
        const parsed = JSON.parse(match[1]);
        
        // Merge parsed fields
        normalized = {
          ...normalized,
          ...parsed,
          // Re-nest data if it came from parsed result
          data: parsed.result ? { columns: parsed.result.columns, rows: parsed.result.rows } : (parsed.data || (Array.isArray(parsed) ? { rows: parsed } : parsed)),
          analysis: parsed.analysis || (preResultsText.length > 0 ? preResultsText : null) || normalized.analysis || null
        };
      } catch (e) {
        console.error('Failed to parse OCI Results JSON from string:', e);
      }
    }
  }

  // 2. Map standard OCI fields to expected internal format
  // Map sql -> sql_query
  if (normalized.sql && !normalized.sql_query) {
    normalized.sql_query = normalized.sql;
  }
  
  // Map query -> title if title is missing
  if (normalized.query && !normalized.title) {
    normalized.title = normalized.query;
  }
  
  // Ensure data structure is accessible at top level for extractRowsAndColumns
  if (normalized.data?.result) {
    normalized.rows = normalized.data.result.rows;
    normalized.columns = normalized.data.result.columns;
    normalized.success = normalized.data.success;
    normalized.row_count = normalized.data.result.row_count;
  }
  
  // Also handle direct data.result structure (if data.result exists at top level)
  if (!normalized.rows && normalized.result) {
    normalized.rows = normalized.result.rows;
    normalized.columns = normalized.result.columns;
  }
  
  // Debug logging for OCI response structure
  if (normalized.query && !normalized.rows) {
    console.log('OCI Response structure debug:', {
      hasData: !!normalized.data,
      hasDataResult: !!normalized.data?.result,
      hasResult: !!normalized.result,
      dataKeys: normalized.data ? Object.keys(normalized.data) : [],
      resultKeys: normalized.result ? Object.keys(normalized.result) : []
    });
  }

  // Fallback for success message
  if (backendDetailMessage) {
    normalized.error_message = backendDetailMessage;
  } else if (!normalized.response && (normalized.success === true || normalized.data?.success === true)) {
    normalized.response = 'Query executed successfully.';
  }

  // 3. Auto-generate visualization if missing
  if (!normalized.visualization) {
    const rows = normalized.rows || normalized.data?.rows || normalized.data?.result?.rows;
    const columns = normalized.columns || normalized.data?.columns || normalized.data?.result?.columns;
    
    if (Array.isArray(rows) && rows.length > 0 && Array.isArray(columns) && columns.length > 0) {
      // Ensure first column exists and is valid
      const firstColumn = columns[0];
      if (firstColumn && firstColumn.trim() !== '') {
      // Find numeric column for Y axis (skip first column usually labels)
      let numericColIndex = -1;
      for (let i = 1; i < columns.length; i++) {
        const sampleVal = Array.isArray(rows[0]) ? rows[0][i] : rows[0][columns[i]];
        if (typeof sampleVal === 'number' || (typeof sampleVal === 'string' && !isNaN(parseFloat(sampleVal)))) {
          numericColIndex = i;
          break;
        }
      }

        if (numericColIndex !== -1 && columns[numericColIndex]) {
        normalized.visualization = {
          chartType: 'bar',
            xAxis: firstColumn,
          yAxis: columns[numericColIndex],
          title: normalized.title || 'Data Visualization'
        };
        }
      }
    }
  }
  
  // 4. Map other rich fields with fallbacks
  normalized.analysis = normalized.analysis || normalized.data?.analysis || null;
  
  // Generate a basic analysis if missing but we have rows and a query
  if (!normalized.analysis && normalized.rows && normalized.rows.length > 0 && normalized.query) {
    normalized.analysis = `Based on your request regarding "${normalized.query}", I have retrieved the following ${normalized.rows.length} ${normalized.rows.length === 1 ? 'result' : 'results'}.`;
  } else if (!normalized.analysis && normalized.rows && normalized.rows.length > 0) {
    normalized.analysis = `I found ${normalized.rows.length} ${normalized.rows.length === 1 ? 'record' : 'records'} matching your query.`;
  }

  normalized.insights = normalized.insights || normalized.KeyInformation || normalized.key_information || normalized.data?.insights || null;
  normalized.insightsHeader = normalized.insightsHeader || ((normalized.KeyInformation || normalized.key_information) ? 'Key Information' : 'Key Insights');
  normalized.title = normalized.title || normalized.header || normalized.data?.title || null;
  normalized.subtitle = normalized.subtitle || normalized.subheader || normalized.data?.subtitle || null;

  // Final normalization of sql_query
  normalized.sql_query = normalized.sql_query || normalized.sql || (normalized.data && (normalized.data.sql || normalized.data.sql_query)) || null;

  return normalized;
}

/**
 * Extracts rows and columns from normalized response
 * @param {Object} data - Normalized response data
 * @returns {Object} { rows, columns }
 */
export function extractData(data) {
  if (!data) return { rows: null, columns: null };

  let rows = null;
  // Priority 1: Check top-level rows (set by normalizer)
  if (Array.isArray(data.rows) && data.rows.length > 0) {
    rows = data.rows;
  } 
  // Priority 2: Check nested data.result.rows (OCI/AWS format)
  else if (Array.isArray(data.data?.result?.rows) && data.data.result.rows.length > 0) {
    rows = data.data.result.rows;
  } 
  // Priority 3: Check data.rows
  else if (Array.isArray(data.data?.rows) && data.data.rows.length > 0) {
    rows = data.data.rows;
  } 
  // Priority 4: Check result.rows
  else if (Array.isArray(data.result?.rows) && data.result.rows.length > 0) {
    rows = data.result.rows;
  } 
  // Priority 5: Check if data itself is an array
  else if (Array.isArray(data.data) && data.data.length > 0) {
    rows = data.data;
  }
  // Priority 6: Accept empty arrays (for debugging)
  else if (Array.isArray(data.rows)) {
    rows = data.rows;
  } else if (Array.isArray(data.data?.result?.rows)) {
    rows = data.data.result.rows;
  }

  let columns = null;
  // Priority 1: Check top-level columns (set by normalizer)
  if (Array.isArray(data.columns) && data.columns.length > 0) {
    columns = data.columns;
  } 
  // Priority 2: Check nested data.result.columns (OCI/AWS format)
  else if (Array.isArray(data.data?.result?.columns) && data.data.result.columns.length > 0) {
    columns = data.data.result.columns;
  } 
  // Priority 3: Check data.columns
  else if (Array.isArray(data.data?.columns) && data.data.columns.length > 0) {
    columns = data.data.columns;
  } 
  // Priority 4: Check result.columns
  else if (Array.isArray(data.result?.columns) && data.result.columns.length > 0) {
    columns = data.result.columns;
  } 
  // Priority 5: Check columnNames
  else if (Array.isArray(data.data?.columnNames) && data.data.columnNames.length > 0) {
    columns = data.data.columnNames;
  }
  // Priority 6: Accept empty arrays (for debugging)
  else if (Array.isArray(data.columns)) {
    columns = data.columns;
  } else if (Array.isArray(data.data?.result?.columns)) {
    columns = data.data.result.columns;
  }

  // If we have rows but no columns, and rows are objects, extract columns from keys
  if (rows && rows.length > 0 && !columns) {
    if (!Array.isArray(rows[0]) && typeof rows[0] === 'object' && rows[0] !== null) {
      columns = Object.keys(rows[0]);
    }
  }

  // Debug logging if extraction fails
  if (!rows && data && (data.data || data.result)) {
    console.log('extractData debug - no rows found:', {
      hasData: !!data.data,
      hasResult: !!data.result,
      dataStructure: data.data ? Object.keys(data.data) : [],
      resultStructure: data.result ? Object.keys(data.result) : []
    });
  }

  return { rows, columns };
}

