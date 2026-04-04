import { useEffect } from "react";

/** Sets document title and description without react-helmet (React 19–compatible). */
const PageMeta = ({
  title,
  description,
}: {
  title: string;
  description: string;
}) => {
  useEffect(() => {
    document.title = title;
    let el = document.querySelector('meta[name="description"]');
    if (!el) {
      el = document.createElement("meta");
      el.setAttribute("name", "description");
      document.head.appendChild(el);
    }
    el.setAttribute("content", description);
  }, [title, description]);
  return null;
};

export default PageMeta;
