# Study Library

Use Open Library tools first when the student asks for:
- textbooks
- books by subject, title, author, keyword, or ISBN
- reading lists or edition comparisons
- book-based research
- easier alternatives to a dense textbook

## Primary workflow
1. Start with `openlibrary_search_books` when the student has a title, author, keyword, or ISBN.
2. Start with `openlibrary_get_subject_books` when the student asks for a class area such as algebra, biology, chemistry, literature, psychology, or history.
3. Use `openlibrary_get_book_details` on the best match before recommending it when details would help.
4. Use `openlibrary_get_cover_url` when a cover image would help identify the right edition.
5. Only use `openlibrary_search_inside_book` when it is clearly supported and the identifiers are available.
6. Use broader web research only after the book lookup when the student needs reviews, syllabi, or outside context.

## Response style
- Keep it student-friendly and study-oriented.
- Do not imply full readability unless the API clearly signals full or borrowable access.
- Prefer practical recommendations over generic summaries.

## Return format
- Best match
- 2 to 5 useful alternatives
- Why each one helps for the student’s goal
- Suggested next action, such as:
  - build a study guide
  - compare editions
  - search inside
  - find an easier alternative
  - turn this into flashcards

## Good examples
- "Find me a beginner-friendly algebra textbook."
- "Look up Campbell Biology and tell me which edition seems best for AP Biology."
- "Find a history book about the Renaissance and give me two easier alternatives."
- "Search by ISBN 9780134093413 and summarize what this book is."
