import sortBy from 'lodash/sortBy'

class Event {
  constructor(data, { accessors, slotMetrics }) {
    const {
      start,
      startDate,
      end,
      endDate,
      top,
      height,
    } = slotMetrics.getRange(accessors.start(data), accessors.end(data))

    this.start = start
    this.end = end
    this.startMs = +startDate
    this.endMs = +endDate
    this.top = top
    this.height = height
    this.data = data
  }
}

function assignEventPositioning(events, columns) {
  const numberOfColumns = columns.length
  const widthPerColumn = 100 / numberOfColumns

  events.forEach(event => {
    let indexOfOverlap = numberOfColumns

    // Find the column that contains an event that overlaps with the current event
    for (let i = event.column + 1; i < numberOfColumns; i++) {
      const overlap = columns[i].find(c => c.end > event.start)

      if (overlap) {
        indexOfOverlap = i
        break
      }
    }

    event.indexOfOverlap = indexOfOverlap
    event.width = (indexOfOverlap - event.column) * widthPerColumn
    event.xOffset = event.column * widthPerColumn
  })
}

function getStyledEvents({ events, slotMetrics, accessors }) {
  const proxies = events.map(
    event => new Event(event, { slotMetrics, accessors })
  )
  const eventsInRenderOrder = sortBy(proxies, ['startMs', e => -e.endMs])

  // Group events by column
  const columns = []

  for (let i = 0; i < eventsInRenderOrder.length; i++) {
    const event = eventsInRenderOrder[i]

    // Check each column to see where the event can fit without overlapping other events
    for (let columnIndex = 0; columnIndex < columns.length; columnIndex++) {
      const overlap = columns[columnIndex].find(c => c.end > event.start)

      // Add the event to the current column if it doesn't overlap
      if (!overlap) {
        event.column = columnIndex
        columns[columnIndex].push(event)
        break
      }
    }

    // If no column is found, create a new column and add the event to it.
    if (typeof event.column === 'undefined') {
      columns.push([event])
      event.column = columns.length - 1
    }
  }

  assignEventPositioning(eventsInRenderOrder, columns)

  // Return the original events, along with their styles.
  return eventsInRenderOrder.map(event => ({
    event: event.data,
    style: {
      top: event.top,
      height: event.height,
      width: event.width,
      xOffset: event.xOffset,
      zIndex: Math.floor(event.xOffset),
    },
  }))
}

export { getStyledEvents }
