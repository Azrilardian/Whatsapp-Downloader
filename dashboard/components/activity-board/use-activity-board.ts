import { useReducer } from 'react';
import { filterEvents, getDistinctContacts } from './utils';
import type { FiltersField, FiltersState, UseActivityBoardProps } from './types';

const INITIAL_FILTERS: FiltersState = { status: 'all', contact: 'all', date: 'all', search: '' };

type FiltersAction = { field: FiltersField; value: string };

function filtersReducer(state: FiltersState, action: FiltersAction): FiltersState {
  return { ...state, [action.field]: action.value };
}

export function useActivityBoard(props: UseActivityBoardProps) {
  const { events } = props;
  const [filters, dispatch] = useReducer(filtersReducer, INITIAL_FILTERS);

  function setField(field: FiltersField, value: string) {
    dispatch({ field, value });
  }

  const filteredEvents = filterEvents(events, filters);
  const contactOptions = getDistinctContacts(events);

  return { filters, setField, filteredEvents, contactOptions };
}
