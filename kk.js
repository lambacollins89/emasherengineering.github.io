// Define the study area
var studyArea = ee.FeatureCollection('projects/ee-lambacollins/assets/Kitwe2020m');

// Define LULC classes
var classNames = ['Water', 'Built-Up Areas', 'Bare Land', 'Vegetation'];
var classValues = [0, 1, 2, 3]; // Pixel values in LULC rasters
var classNamesList = ee.List(classNames); // Convert to ee.List for server-side operations
var significantTransitions = [
  'Vegetation_to_Bare Land', // Deforestation or Land Degradation
  'Vegetation_to_Built-Up Areas', // Deforestation
  'Bare Land_to_Built-Up Areas', // Urbanization
  'Water_to_Water' // Water body changes (persistence)
];

// Load LULC images for each year (select the correct band: b1)
var lulc2000 = ee.Image('projects/ee-lambacollins/assets/Landsat7_Classified_Kitwe_2000').select('b1').clip(studyArea);
var lulc2010 = ee.Image('projects/ee-lambacollins/assets/Landsat7_Classified_Kitwe_2010').select('b1').clip(studyArea);
var lulc2020 = ee.Image('projects/ee-lambacollins/assets/Landsat7_Classified_Kitwe_2020').select('b1').clip(studyArea);
var lulc2024 = ee.Image('projects/ee-lambacollins/assets/Landsat8_9_Classified_Kitwe_2024').select('b1').clip(studyArea);

// List of years and corresponding images
var years = [2000, 2010, 2020, 2024];
var lulcImages = [lulc2000, lulc2010, lulc2020, lulc2024];

// Function to calculate area for each class in hectares
function calculateClassAreas(image, year) {
  var areaImage = ee.Image.pixelArea().divide(10000); // Convert m² to hectares
  var areas = ee.List(classValues).map(function(classValue) {
    var mask = image.eq(ee.Number(classValue)); // Explicitly cast classValue to ee.Number
    var area = areaImage.mask(mask).reduceRegion({
      reducer: ee.Reducer.sum(),
      geometry: studyArea,
      scale: 30,
      maxPixels: 1e10
    });
    return area.getNumber('area');
  });
  
  // Calculate total area
  var totalArea = areaImage.reduceRegion({
    reducer: ee.Reducer.sum(),
    geometry: studyArea,
    scale: 30,
    maxPixels: 1e10
  }).getNumber('area');
  
  // Calculate percentages
  var percentages = areas.map(function(area) {
    return ee.Number(area).divide(totalArea).multiply(100);
  });
  
  // Format results for Table 4
  var result = {};
  classNames.forEach(function(name, index) {
    result[name + '_Area_ha'] = areas.get(index);
    result[name + '_Percent'] = percentages.get(index);
  });
  result['Year'] = year;
  result['Total_Area_ha'] = totalArea;
  
  return ee.Feature(null, result);
}

// Compute areas for each year
var areaFeatures = years.map(function(year, index) {
  return calculateClassAreas(lulcImages[index], year);
});
var areaTable = ee.FeatureCollection(areaFeatures);

// Export Table 4 to CSV
Export.table.toDrive({
  collection: areaTable,
  description: 'LULC_Area_Percentage_2000_2024',
  folder: 'GEE_Exports',
  fileFormat: 'CSV',
  selectors: ee.List(['Year']).cat(
    ee.List(classNames).map(function(name) {
      return ee.List([ee.String(name).cat('_Area_ha'), ee.String(name).cat('_Percent')]);
    }).flatten()
  ).cat(ee.List(['Total_Area_ha']))
});

// Function to calculate net change between two images
function calculateNetChange(image1, image2, startYear, endYear) {
  var netChanges = ee.List(classValues).map(function(classValue) {
    var mask1 = image1.eq(ee.Number(classValue)); // Explicitly cast classValue to ee.Number
    var mask2 = image2.eq(ee.Number(classValue)); // Explicitly cast classValue to ee.Number
    var areaImage = ee.Image.pixelArea().divide(10000); // Convert to hectares
    var area1 = areaImage.mask(mask1).reduceRegion({
      reducer: ee.Reducer.sum(),
      geometry: studyArea,
      scale: 30,
      maxPixels: 1e10
    }).getNumber('area');
    var area2 = areaImage.mask(mask2).reduceRegion({
      reducer: ee.Reducer.sum(),
      geometry: studyArea,
      scale: 30,
      maxPixels: 1e10
    }).getNumber('area');
    return area2.subtract(area1);
  });
  
  var result = {};
  classNames.forEach(function(name, index) {
    result[name + '_NetChange_ha'] = netChanges.get(index);
  });
  result['Period'] = startYear + '-' + endYear;
  
  return ee.Feature(null, result);
}

// Compute net changes for consecutive periods and overall
var periods = [
  [2000, 2010, lulc2000, lulc2010],
  [2010, 2020, lulc2010, lulc2020],
  [2020, 2024, lulc2020, lulc2024],
  [2000, 2024, lulc2000, lulc2024]
];
var netChangeFeatures = periods.map(function(period) {
  return calculateNetChange(period[2], period[3], period[0], period[1]);
});
var netChangeTable = ee.FeatureCollection(netChangeFeatures);

// Export net change results
Export.table.toDrive({
  collection: netChangeTable,
  description: 'LULC_Net_Change_2000_2024',
  folder: 'GEE_Exports',
  fileFormat: 'CSV',
  selectors: ee.List(['Period']).cat(
    ee.List(classNames).map(function(name) {
      return ee.String(name).cat('_NetChange_ha');
    })
  )
});

// Function to create transition matrix
function createTransitionMatrix(image1, image2, startYear, endYear) {
  // Combine images to create transition codes
  var transitionImage = image1.multiply(100).add(image2);
  
  // Calculate area for each transition
  var areaImage = ee.Image.pixelArea().divide(10000); // Convert to hectares
  var transitionAreas = [];
  classValues.forEach(function(fromClass) {
    classValues.forEach(function(toClass) {
      var transitionCode = ee.Number(fromClass).multiply(100).add(toClass);
      var mask = transitionImage.eq(transitionCode);
      var area = areaImage.mask(mask).reduceRegion({
        reducer: ee.Reducer.sum(),
        geometry: studyArea,
        scale: 30,
        maxPixels: 1e10
      }).getNumber('area');
      transitionAreas.push(area);
    });
  });
  
  // Format results for Table 5
  var result = {};
  classNames.forEach(function(fromClass, i) {
    classNames.forEach(function(toClass, j) {
      result[fromClass + '_to_' + toClass] = transitionAreas[i * classNames.length + j];
    });
  });
  result['Period'] = startYear + '-' + endYear;
  
  return ee.Feature(null, result);
}

// Compute transition matrices for each period
var transitionFeatures = periods.map(function(period) {
  return createTransitionMatrix(period[2], period[3], period[0], period[1]);
});
var transitionTable = ee.FeatureCollection(transitionFeatures);

// Create selectors for transition matrix as a flat list of strings
var transitionSelectors = ['Period'];
classNames.forEach(function(fromClass) {
  classNames.forEach(function(toClass) {
    transitionSelectors.push(fromClass + '_to_' + toClass);
  });
});
transitionSelectors = ee.List(transitionSelectors);

// Export Table 5 to CSV
Export.table.toDrive({
  collection: transitionTable,
  description: 'LULC_Transition_Matrix_2000_2024',
  folder: 'GEE_Exports',
  fileFormat: 'CSV',
  selectors: transitionSelectors
});

// Calculate annual rate of change for significant transitions
function calculateAnnualRate(transitionTable, startYear, endYear) {
  var yearsDiff = endYear - startYear;
  
  var feature = transitionTable.filter(ee.Filter.eq('Period', startYear + '-' + endYear)).first();
  var rates = {};
  significantTransitions.forEach(function(transition) {
    var area = ee.Number(feature.get(transition));
    rates[transition + '_AnnualRate_ha_yr'] = area.divide(yearsDiff);
  });
  rates['Period'] = startYear + '-' + endYear;
  
  return ee.Feature(null, rates);
}

var annualRateFeatures = periods.map(function(period) {
  return calculateAnnualRate(transitionTable, period[0], period[1]);
});
var annualRateTable = ee.FeatureCollection(annualRateFeatures);

// Export annual rate of change
Export.table.toDrive({
  collection: annualRateTable,
  description: 'LULC_Annual_Rate_Change_2000_2024',
  folder: 'GEE_Exports',
  fileFormat: 'CSV',
  selectors: ee.List(['Period']).cat(
    ee.List(significantTransitions).map(function(t) {
      return ee.String(t).cat('_AnnualRate_ha_yr');
    })
  )
});

// Print results to console for verification
print('Table 4: LULC Area and Percentage', areaTable);
print('Net Change Table', netChangeTable);
print('Table 5: Transition Matrix', transitionTable);
print('Annual Rate of Change', annualRateTable);