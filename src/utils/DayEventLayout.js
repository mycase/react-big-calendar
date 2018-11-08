import sortBy from 'lodash/sortBy'

class Event {
  constructor(data, eventOverlap, { accessors, slotMetrics }) {
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
    this.containerEnd = end
    this.isContainer = false
    this.overlapping = eventOverlap
    this.overlapBuffer = 0
    this.containerXOffset = 0
    this.parentContainer = null
    this.rootContainer = null
  }

  /**
   * The event's width without any overlap.
   */
  get _width() {
    if (this.isContainer && !this.overlapping) {
      return 0
    }

    const containerColumnCount = this.overlapping ? 1 : 0
    // The container event's width is determined by the maximum number of
    // events in any of its rows.
    if (this.rows) {
      const columns =
        this.rows.reduce(
          (max, row) => Math.max(max, row.leaves.length + 1), // add itself
          0
        ) + containerColumnCount // add the container if necessary

      return 100 / columns
    }

    const availableWidth =
      100 - this.container.containerXOffset - this.container._width

    // The row event's width is the space left by the container, divided
    // among itself and its leaves.
    if (this.leaves) {
      return availableWidth / (this.leaves.length + 1)
    }

    // The leaf event's width is determined by its row's width
    return this.row._width
  }

  /**
   * The event's calculated width, possibly with extra width added for
   * overlapping effect.
   */
  get width() {
    if (!this.overlapping) {
      return this._width
    }

    const noOverlap = this._width
    const overlap = Math.min(100, this._width * 1.7)

    // Containers can always grow.
    if (this.rows) {
      return overlap
    }

    // Rows can grow if they have leaves.
    if (this.leaves) {
      return this.leaves.length > 0 ? overlap : noOverlap
    }

    // Leaves can grow unless they're the last item in a row.
    const { leaves } = this.row
    const index = leaves.indexOf(this)
    return index === leaves.length - 1 ? noOverlap : overlap
  }

  get xOffset() {
    // Containers have no offset.
    if (this.rows || this.isContainer) return 0

    // Rows always start where their container ends.
    if (this.leaves && this.overlapping) {
      return this.container._width
    } else if (this.leaves && !this.overlapping) {
      return this.container.containerXOffset
    }

    // Leaves are spread out evenly on the space left by its row.
    const { leaves, xOffset, _width } = this.row
    const index = leaves.indexOf(this) + 1
    return xOffset + index * _width
  }
}

/**
 * Return true if event a and b is considered to be on the same row.
 */
function onSameRow(a, b, minimumStartDifference) {
  return (
    // Occupies the same start slot.
    Math.abs(b.start - a.start) < minimumStartDifference ||
    // A's start slot overlaps with b's end slot.
    (b.start > a.start && b.start < a.end)
  )
}

function sortByRender(events) {
  return sortBy(events, ['startMs', e => -e.endMs])
}

function calculateContainerOverlapBuffer(container) {
  const eventDuration = container.containerEnd - container.start
  return eventDuration >= 30 ? 5 : 0
}

function assignContainerXOffsets(containerEvents) {
  const indentOffset = 2
  if (containerEvents.length > 1) {
    containerEvents[0].containerXOffset = 0

    for (let i = 1; i < containerEvents.length; i++) {
      const previousContainer = containerEvents[i - 1]
      const currentContainer = containerEvents[i]
      if (previousContainer.containerEnd > currentContainer.start) {
        const firstEventOfPreviousContainer = previousContainer.rows[0]
        if (firstEventOfPreviousContainer.end > currentContainer.start) {
          currentContainer.containerXOffset =
            previousContainer.containerXOffset + indentOffset
        } else {
          currentContainer.containerXOffset = 0
        }
      } else {
        currentContainer.containerXOffset = 0
      }
    }
  }
}

function assignChildContainerXOffsets(containerEvents) {
  containerEvents.forEach(container => {
    let currentContainer = container
    const parentContainer = currentContainer.parentContainer
    const parentRow = parentContainer.rows[0]
    const leaves = parentRow.leaves
    const rowAndLeaves = [parentRow, ...leaves]

    // Find the X Offset of the event after the child container
    for (let i = 0; i < rowAndLeaves.length - 1; i++) {
      if (
        currentContainer.start === rowAndLeaves[i].start &&
        currentContainer.end === rowAndLeaves[i].end
      ) {
        currentContainer.containerXOffset = rowAndLeaves[i + 1].xOffset
      }
    }
  })
}

function getStyledEvents(eventOverlap, _) {
  if (eventOverlap) {
    return getStyledOverlappingEvents(...arguments)
  } else {
    return getStyledNonOverlappingEvents(...arguments)
  }
}

function getStyledNonOverlappingEvents(
  eventOverlap,
  { events, _, slotMetrics, accessors }
) {
  const proxies = events.map(
    event => new Event(event, eventOverlap, { slotMetrics, accessors })
  )
  const eventsInRenderOrder = sortByRender(proxies)

  // Group overlapping events, while keeping order.
  // Every event is always one of: container, row or leaf.
  // Containers can contain rows, and rows can contain leaves.
  const containerEvents = []
  const childContainerEvents = []

  for (let i = 0; i < eventsInRenderOrder.length; i++) {
    const event = eventsInRenderOrder[i]

    // Check if this event can go into a container event.
    let container = containerEvents.find(
      c => c.containerEnd > event.start + c.overlapBuffer
    )

    // Couldn't find a container — that means this event is a container.
    if (!container) {
      container = new Event(event.data, false, { slotMetrics, accessors })
      container.rows = []
      container.isContainer = true
      container.overlapBuffer = calculateContainerOverlapBuffer(container)
      container.rootContainer = container
      container.parentContainer = container
      containerEvents.push(container)
    }

    // Found a container for the event.
    event.container = container

    // Expand the container if possible
    if (event.end > container.containerEnd) {
      container.containerEnd = event.end
      container.overlapBuffer = calculateContainerOverlapBuffer(container)
    }

    // See if the event can fit into a child container
    for (let i = childContainerEvents.length - 1; i >= 0; i--) {
      const currentContainer = childContainerEvents[i]
      if (
        currentContainer.start <= event.start &&
        currentContainer.containerEnd > event.start
      ) {
        container = currentContainer
        event.container = container

        if (event.end > container.containerEnd) {
          container.containerEnd = event.end
          container.rootContainer.containerEnd = Math.max(
            event.end,
            container.rootContainer.containerEnd
          )
          container.rootContainer.overlapBuffer = calculateContainerOverlapBuffer(
            container.rootContainer
          )
        }
        break
      }
    }

    // Each container only has one row using the non overlapping algorithm
    let row = container.rows[0]

    // Look back to see if a child container should be created from the row
    if (row) {
      let rowAndLeaves
      if (row.leaves) {
        rowAndLeaves = [row, ...row.leaves]
      } else {
        rowAndLeaves = [row]
      }

      if (event.start >= rowAndLeaves[rowAndLeaves.length - 1].end) {
        let newContainerEvent = rowAndLeaves
          .reverse()
          .find(e => e.end > event.start)

        /* If a container cannot be made from any of the events of the previous container,
         * then a child container must be made of the current container's parent which makes the child
         * container a sibling of the current container */
        let isSibling = newContainerEvent ? false : true
        newContainerEvent = newContainerEvent
          ? newContainerEvent
          : row.container

        const newContainer = new Event(newContainerEvent.data, false, {
          slotMetrics,
          accessors,
        })

        newContainer.isContainer = true
        newContainer.rows = []

        newContainer.parentContainer = isSibling
          ? container.parentContainer
          : container

        newContainer.rootContainer = container.rootContainer
        container = newContainer
        childContainerEvents.push(container)
        row = null
        event.container = container

        if (event.end > container.containerEnd) {
          container.containerEnd = event.end
          container.rootContainer.containerEnd = Math.max(
            event.end,
            container.rootContainer.containerEnd
          )
          container.rootContainer.overlapBuffer = calculateContainerOverlapBuffer(
            container.rootContainer
          )
        }
      }
    }

    if (row) {
      // Found a row, so add it.
      row.leaves.push(event)
      event.row = row
    } else {
      // Couldn't find a row – that means this event is a row.
      event.leaves = []
      container.rows.push(event)
    }
  }

  assignContainerXOffsets(containerEvents)
  assignChildContainerXOffsets(childContainerEvents)

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

function getStyledOverlappingEvents(
  eventOverlap,
  { events, minimumStartDifference, slotMetrics, accessors }
) {
  const proxies = events.map(
    event => new Event(event, eventOverlap, { slotMetrics, accessors })
  )
  const eventsInRenderOrder = sortByRender(proxies)

  // Group overlapping events, while keeping order.
  // Every event is always one of: container, row or leaf.
  // Containers can contain rows, and rows can contain leaves.
  const containerEvents = []

  for (let i = 0; i < eventsInRenderOrder.length; i++) {
    const event = eventsInRenderOrder[i]

    // Check if this event can go into a container event.
    let container = containerEvents.find(
      c =>
        c.containerEnd > event.start ||
        Math.abs(event.start - c.start) < minimumStartDifference
    )

    // Couldn't find a container — that means this event is a container.
    if (!container) {
      event.rows = []
      event.isContainer = true
      containerEvents.push(event)
      continue
    }

    // Found a container for the event.
    event.container = container

    // Check if the event can be placed in an existing row.
    // Start looking from behind.
    let row = null
    for (let j = container.rows.length - 1; !row && j >= 0; j--) {
      if (onSameRow(container.rows[j], event, minimumStartDifference)) {
        row = container.rows[j]
      }
    }

    if (row) {
      // Found a row, so add it.
      row.leaves.push(event)
      event.row = row
    } else {
      // Couldn't find a row – that means this event is a row.
      event.leaves = []
      container.rows.push(event)
    }
  }

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
