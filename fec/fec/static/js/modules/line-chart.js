'use strict';

/* global module, DEFAULT_TIME_PERIOD */

/**
 * @fileOverview Used to write the line charts into the page(s)
 *
 * @author      fec.gov
 *
 * @requires    jquery
 * @requires    underscore
 * @requires    d3-array
 * @requires    d3-axis
 * @requires    d3-scale
 * @requires    d3-selection
 * @requires    d3-shape
 * @requires    d3-time-format
 * @requires    numeral
 * @requires    ./helpers
 */

var $ = require('jquery');
var _ = require('underscore');
var d3 = Object.assign(
  {},
  require('d3-array'), // d3.bisector, ticks
  require('d3-axis'), // d3.axisBottom
  require('d3-scale'), // d3.scaleTime
  require('d3-selection'), // d3.select, d3.event
  require('d3-shape'), // d3.line
  require('d3-time-format') // d3.timeFormat
);
var numeral = require('numeral');
var helpers = require('./helpers');

var parseM = d3.timeFormat('%b');
var parseMY = d3.timeFormat('%b %Y');
var parseMDY = d3.timeFormat('%m/%d/%Y');
var parsePlotPoints = d3.timeFormat('%Y-%m-01T%H:%M:%S.%L');

var bisectDate = d3.bisector(function(d) {
  return d.date;
}).left;

var currentYear = new Date().getFullYear();
var MIN_CYCLE = 2008;
var MAX_CYCLE = currentYear % 2 === 0 ? currentYear : currentYear + 1;
var MAX_RANGE = 4000000000; // Set the max y-axis to 4 billion

/**
 * Line Chart
 * @constructor
 *
 * Creates an SVG line chart for total raising and spending
 *
 * @param {String} selector - Selector of the parent element
 * @param {String} snapshot - Selector to use for the snapshot,
 *   which is the set of numbers that is updated when moving the cursor
 * @param {String} dataType - The type of data the chart is showing ('raised' or 'spent')
 */
function LineChart(selector, snapshot, dataType) {
  this.element = d3.select(selector);
  this.dataType = dataType;
  this.cycle = Number(DEFAULT_TIME_PERIOD);
  this.entityNames = ['candidate', 'party', 'pac'];
  this.margin = { top: 10, right: 20, bottom: 30, left: 50 };
  this.baseWidth = $(selector).width();
  this.baseHeight = this.baseWidth * 0.5;
  this.height = this.baseHeight - this.margin.top - this.margin.bottom;
  this.width = this.baseWidth - this.margin.left - this.margin.right;
  this.startCursorAtEnd = true;

  // Locate DOM elements
  this.$snapshot = $(snapshot);
  this.$prev = this.$snapshot.find('.js-snapshot-prev');
  this.$next = this.$snapshot.find('.js-snapshot-next');

  // Fetch the data and build the chart
  this.fetch(this.cycle);

  // Set the snapshot height if we're in a medium-sized screen
  if (helpers.isMediumScreen()) {
    this.$snapshot.height(this.baseHeight - this.margin.bottom);
  }

  // Add event listeners
  this.element.on('mousemove', this.handleMouseMove.bind(this));
  this.$prev.on('click', this.goToPreviousMonth.bind(this));
  this.$next.on('click', this.goToNextMonth.bind(this));
}

LineChart.prototype.fetch = function(cycle) {
  var entityTotalsURL = helpers.buildUrl(['totals', 'by_entity'], {
    cycle: cycle,
    per_page: '100'
  });

  $.getJSON(entityTotalsURL).done(this.handleResponse.bind(this));
};

LineChart.prototype.handleResponse = function(response) {
  // Format the response and call all necessary methods to get the presentation right
  this.groupDataByType(response.results);
  this.drawChart();
  this.moveCursor();
  this.setupSnapshot(this.cycle);
};

/**
 * @desc Takes the results of the response and groups it into data for the chart.
 * Stores an array of objects for each month, with either raising or spending totals depending on the dataType of the chart
 * @param {Object} results -
 */
LineChart.prototype.groupDataByType = function(results) {
  var formattedData = [];
  var dataType = this.dataType;
  var today = new Date();
  _.each(results, function(item) {
    var datum;
    var date = helpers.utcDate(item.end_date);
    // If the data is in the future, it's probably wrong, so ignore it
    if (date > today) {
      return;
    }

    if (dataType === 'raised') {
      datum = {
        date: date,
        candidate: item.cumulative_candidate_receipts,
        pac: item.cumulative_pac_receipts,
        party: item.cumulative_party_receipts
      };
    } else {
      datum = {
        date: date,
        candidate: item.cumulative_candidate_disbursements,
        pac: item.cumulative_pac_disbursements,
        party: item.cumulative_party_disbursements
      };
    }
    formattedData.push(datum);
  });

  this.chartData = _.sortBy(formattedData, 'date');
};

/**
 * @desc Create separate arrays of data for each entity type.
 * These will be used to draw the lines on the chart
 * @returns {Object}
 */
LineChart.prototype.groupEntityTotals = function() {
  var chartData = this.chartData;
  var entityTotals = {};
  this.entityNames.forEach(function(type) {
    var totals = chartData.map(function(d) {
      return {
        date: d.date,
        amount: d[type] || 0
      };
    });
    entityTotals[type] = totals;
  });
  return entityTotals;
};

LineChart.prototype.getMaxAmount = function(entityTotals) {
  var max = 0;

  _.each(entityTotals, function(element) {
    var entityMax = _.max(element, function(item) {
      return item.amount;
    });
    max = max >= entityMax.amount ? max : entityMax.amount;
  });

  return max;
};

/**
 * @desc Set the x-scale to be from the first of the first year to the last day of the cycle
 * @returns {Number} x
 */
LineChart.prototype.setXScale = function() {
  var x = d3
    .scaleTime()
    .domain([
      new Date('01/01/' + String(this.cycle - 1)),
      new Date('12/31/' + String(this.cycle))
    ])
    .nice(d3.timeMonth)
    .range([0, this.width]);
  this.x = x;
  return x;
};

/**
 * @desc Set the y-axis from 0 to the MAX_RANGE ($4 billion)
 * @param {Number} amount -
 * @returns {Number}
 */
LineChart.prototype.setYScale = function(amount) {
  amount = amount || MAX_RANGE;

  var y = d3
    .scaleLinear()
    .domain([0, Math.ceil(amount / 100000000) * 100000000])
    .range([this.height, 0]);
  return y;
};

/**
 * @desc Adds a basic SVG container with all the right dimensions
 * @returns svg
 */
LineChart.prototype.appendSVG = function() {
  var svg = this.element
    .append('svg')
    .attr('class', 'bar-chart')
    .attr('width', '100%')
    .attr('height', this.height + this.margin.top + this.margin.bottom)
    .append('g')
    .attr(
      'transform',
      'translate(' + this.margin.left + ',' + this.margin.top + ')'
    );
  return svg;
};

/**
 * @todo Restore the black bottom border / x axis
 * @ desc
 */
LineChart.prototype.drawChart = function() {
  var entityTotals = this.groupEntityTotals();
  var maxY = this.getMaxAmount(entityTotals);
  var x = this.setXScale();
  var y = this.setYScale(maxY);
  var xAxis = d3
    .axisBottom(x)
    .ticks(d3.timeMonth)
    .tickFormat(this.xAxisFormatter());
  var yAxis = d3
    .axisRight(y)
    .tickSize(this.width)
    .tickFormat(function(d) {
      return numeral(d).format('($0.0a)');
    });

  // Create the base SVG
  var svg = this.appendSVG();

  // Add the xAxis
  svg
    .append('g')
    .attr('class', 'x axis')
    .attr('transform', 'translate(0,' + this.height + ')')
    .call(xAxis);

  // Add the yAxis
  svg
    .append('g')
    .attr('class', 'y axis')
    .call(yAxis)
    .selectAll('text')
    .attr('y', -4)
    .attr('x', -4)
    .attr('dy', '.71em')
    .style('text-anchor', 'end');

  var lineBuilder = d3
    .line()
    .x(function(d) {
      var myDate = new Date(parsePlotPoints(d.date));
      return x(myDate);
    })
    .y(function(d) {
      return y(d.amount);
    });

  // Draw a line and populate data for each entity type
  this.entityNames.forEach(function(entity) {
    var line = svg.append('g').attr('class', 'line--' + entity);
    var points = line.append('g').attr('class', 'line__points');

    line
      .append('path')
      .datum(entityTotals[entity])
      .attr('d', lineBuilder)
      .attr('stroke-width', 2)
      .attr('fill', 'none');

    points
      .selectAll('circle')
      .data(entityTotals[entity])
      .enter()
      .append('circle')
      .attr('cx', function(d) {
        var myDate = new Date(parsePlotPoints(d.date));
        return x(myDate);
      })
      .attr('cy', function(d) {
        return y(d.amount);
      })
      .attr('r', 2);
  });

  this.drawCursor(svg);
};

LineChart.prototype.drawCursor = function(svg) {
  // Add a dotted vertical line for the cursor
  this.cursor = svg
    .append('line')
    .attr('class', 'cursor')
    .attr('stroke-dasharray', '5,5')
    .attr('x1', 10)
    .attr('x2', 10)
    .attr('y1', 0)
    .attr('y2', this.height - 2);
};

LineChart.prototype.xAxisFormatter = function() {
  // Draw tick marks for the x-axis at different intervals depending on screen size
  var formatter;
  if (helpers.isMediumScreen()) {
    formatter = function(d) {
      if (d.getMonth() === 0) {
        return parseMY(d);
      } else if (d.getMonth() % 2 === 0) {
        return parseM(d);
      } else {
        return '';
      }
    };
  } else {
    formatter = function(d) {
      if (d.getMonth() === 0) {
        return parseMY(d);
      } else if (d.getMonth() % 4 === 0) {
        return parseM(d);
      } else {
        return '';
      }
    };
  }

  return formatter;
};

/**
 * @desc Handles the user mouse movement and sends the data to moveCursor()
 */
LineChart.prototype.handleMouseMove = function() {
  // REQUIRED TO USE d3.event WITH BUNDLERS:
  d3.getEvent = () => require('d3-selection').event;

  // NEED TO FIND A DOM ELEMENT TO USE WITH d3.clientPoint()
  var domElement = this.element.select('svg')._groups[0][0];

  var x0 = this.x.invert(d3.clientPoint(domElement, d3.getEvent())[0]);
  var i = bisectDate(this.chartData, x0, 1);
  var d = this.chartData[i - 1];
  this.moveCursor(d);
};

/**
 * @desc Takes data from handleMouseMove() and updates the position of the vertical line and the data on the right
 * @param object $datum - chartData from handleMouseMove()
 */
LineChart.prototype.moveCursor = function(datum) {
  var target = datum ? datum : this.getCursorStartPosition();
  var i = this.chartData.indexOf(target);
  var myDate = new Date(parsePlotPoints(target.date));
  this.cursor.attr('x1', this.x(myDate)).attr('x2', this.x(myDate));
  this.nextDatum = this.chartData[i + 1] || false;
  this.prevDatum = this.chartData[i - 1] || false;
  this.populateSnapshot(target);
  this.element
    .selectAll('.line__points circle')
    .attr('r', 2)
    .filter(function(d) {
      return d.date === target.date;
    })
    .attr('r', 4);
};

/**
 * @desc Determines whether to start the cursor at the begining or end of a time period
 * this.startCursorAtEnd is set to true by default, but when navigating
 * to next cycle, it is set to false so that the cursor starts at the beginning
 * @returns ChartData
 */
LineChart.prototype.getCursorStartPosition = function() {
  if (this.startCursorAtEnd) {
    return this.chartData[this.chartData.length - 1];
  } else {
    return this.chartData[0];
  }
};

/**
 * @desc Change the header of the snapshot to show the correct dates when a new cycle is set
 * @param object $cycle -
 */
LineChart.prototype.setupSnapshot = function(cycle) {
  var firstYear = cycle - 1;
  var firstOfCycle = new Date('01/01/' + firstYear);
  this.$snapshot.find('.js-min-date').html(parseMDY(firstOfCycle));
};

/**
 * @desc Update the snapshot with the correct dates, data and decimal-padding\
 * @param ChartData $datum -
 */
LineChart.prototype.populateSnapshot = function(datum) {
  this.snapshotSubtotals(datum);
  this.snapshotTotal(datum);
  this.$snapshot.find('.js-max-date').html(parseMDY(datum.date));
  helpers.zeroPad(
    this.$snapshot,
    '.snapshot__item-number',
    '.figure__decimals'
  );
};

/**
 * @desc Update the snapshot with the values for each category
 * @param object $datum -
 */
LineChart.prototype.snapshotSubtotals = function(datum) {
  this.$snapshot.find('[data-total-for]').each(function() {
    var category = $(this).data('total-for');
    var value = helpers.currency(datum[category]);
    $(this).html(value);
  });
};

/**
 * @desc Total all the categories and show it as the total total
 * @param object $datum -
 */
LineChart.prototype.snapshotTotal = function(datum) {
  var total = _.chain(datum)
    .omit('date')
    .values()
    .reduce(function(a, b) {
      return a + b;
    })
    .value();
  this.$snapshot.find('[data-total-for="all"]').html(helpers.currency(total));
};

LineChart.prototype.goToNextMonth = function() {
  if (this.nextDatum) {
    this.moveCursor(this.nextDatum);
  } else if (this.cycle < MAX_CYCLE) {
    this.startCursorAtEnd = false;
    this.nextCycle();
  }
};

LineChart.prototype.goToPreviousMonth = function() {
  if (this.prevDatum) {
    this.moveCursor(this.prevDatum);
  } else if (this.cycle > MIN_CYCLE) {
    this.startCursorAtEnd = true;
    this.previousCycle();
  }
};

LineChart.prototype.removeSVG = function() {
  this.element.select('svg').remove();
};

LineChart.prototype.previousCycle = function() {
  this.removeSVG();
  this.cycle = this.cycle - 2;
  this.fetch(this.cycle);
};

LineChart.prototype.nextCycle = function() {
  this.removeSVG();
  this.cycle = this.cycle + 2;
  this.fetch(this.cycle);
};

module.exports = {
  LineChart: LineChart
};
