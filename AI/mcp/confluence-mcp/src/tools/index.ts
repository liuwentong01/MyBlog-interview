import { HandlerMap } from '../types.js';
import { GET_CONTENT_TOOL, handleGetContent } from './get-content.js';
import { SEARCH_TOOL, handleSearch } from './search.js';
import { LIST_SPACES_TOOL, handleListSpaces } from './list-spaces.js';
import { GET_CHILDREN_TOOL, handleGetChildren } from './get-children.js';
import {
  CREATE_PAGE_TOOL,
  UPDATE_PAGE_TOOL,
  handleCreatePage,
  handleUpdatePage,
} from './create-content.js';

export const ALL_TOOLS = [
  GET_CONTENT_TOOL,
  SEARCH_TOOL,
  LIST_SPACES_TOOL,
  GET_CHILDREN_TOOL,
  CREATE_PAGE_TOOL,
  UPDATE_PAGE_TOOL,
];

export const HANDLER_MAP: HandlerMap = {
  [GET_CONTENT_TOOL.name]: handleGetContent,
  [SEARCH_TOOL.name]: handleSearch,
  [LIST_SPACES_TOOL.name]: handleListSpaces,
  [GET_CHILDREN_TOOL.name]: handleGetChildren,
  [CREATE_PAGE_TOOL.name]: handleCreatePage,
  [UPDATE_PAGE_TOOL.name]: handleUpdatePage,
};
