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

function eventsOverlap(a, b) {
  return (
    (a.start < b.end && b.start < a.end) || (b.start < a.end && a.start < b.end)
  )
}

function assignEventPositioning(events, columns) {
  const numberOfColumns = columns.length
  const widthPerColumn = 100 / numberOfColumns

  // First pass, assign initial widths and z-indexes without optimization
  events.forEach(event => {
    let indexOfOverlap = numberOfColumns

    // Find the column that contains an event that overlaps with the current event
    for (let i = event.column + 1; i < numberOfColumns; i++) {
      const overlap = columns[i].find(c => eventsOverlap(c, event))

      if (overlap) {
        indexOfOverlap = i
        break
      }
    }

    event.indexOfOverlap = indexOfOverlap
    event.width = (indexOfOverlap - event.column) * widthPerColumn
    event.xOffset = event.column * widthPerColumn
  })

  // Reposition and adjust widths of events based on last event in a logical row
  redistributeEventWidths(events, columns, widthPerColumn)
}

function redistributeEventWidths(events, columns, widthPerColumn) {
  events.forEach(event => {
    let widthToDistribute = event.width
    let stack = []

    /* If the event fills up the remaining width of the window, see if that width can be
     * distributed to some events to the left */
    if (event.width > widthPerColumn && event.column !== 0 && !event.adjusted) {
      let currentEvent = event
      for (let i = event.column; i > 0; i--) {
        let overlappingEvents = columns[i - 1].filter(c =>
          eventsOverlap(c, currentEvent)
        )

        // Only allow width redistribution to next event if it only overlaps with the current event
        if (overlappingEvents.length === 1) {
          currentEvent = overlappingEvents[0]
          overlappingEvents = columns[i].filter(c =>
            eventsOverlap(c, currentEvent)
          )

          if (overlappingEvents.length === 1 && !currentEvent.adjusted) {
            widthToDistribute += currentEvent.width
            stack.push(currentEvent)
          } else {
            break
          }
        }
      }
    }

    // Reposition events based on redistributed width, starting with current event
    if (stack.length > 0) {
      const normalizedEventWidth = widthToDistribute / (stack.length + 1)
      event.xOffset = event.xOffset + (event.width - normalizedEventWidth)
      event.width = normalizedEventWidth
      event.adjusted = true

      const adjacentEvent = stack[0]

      adjacentEvent.xOffset = event.xOffset - normalizedEventWidth
      adjacentEvent.width = normalizedEventWidth
      adjacentEvent.adjusted = true

      for (let i = 1; i < stack.length; i++) {
        stack[i].xOffset = stack[i - 1].xOffset - normalizedEventWidth
        stack[i].width = normalizedEventWidth
        stack[i].adjusted = true
      }
    }
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
      const overlap = columns[columnIndex].find(c => eventsOverlap(c, event))

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

  //Assign z-indexes to events from top to bottom descending
  let zIndexCtr = eventsInRenderOrder.length

  // Return the original events, along with their styles.
  return eventsInRenderOrder.map(event => ({
    event: event.data,
    style: {
      top: event.top,
      height: event.height,
      width: event.width,
      xOffset: event.xOffset,
      zIndex: zIndexCtr--,
    },
  }))
}

export { getStyledEvents }
